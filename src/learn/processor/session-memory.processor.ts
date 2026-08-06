import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';

/**
 * Persists the agent's end-of-session episodic memory (message_type
 * "session_memory") emitted once per session by ally-ai-learn onto the
 * scenario_session_details row (sessionMemory jsonb, atomic upsert). This is
 * the durable source getPreviousCaseMemory prefers when building the next
 * case session's previousMemory. Mirrors TurnMetricsProcessor: resolve the
 * session by room_id, skip previews, no-op when the session isn't found.
 */
@Injectable()
export class SessionMemoryProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    SessionMemoryProcessor.name,
  );

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly trackMemoryService: TrackMemoryService,
    private readonly trackProgressService: TrackProgressService,
    private readonly caseSharedService: CaseSharedService,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.SESSION_MEMORY;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const sessionMemory = learnData?.session_memory;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (room_id.startsWith('preview-')) {
      return;
    }

    if (!sessionMemory?.summary?.trim()) {
      this.logger.warn(`Session memory payload missing for room: ${room_id}`);
      return;
    }

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        // The session row may not exist yet (race) or this is a non-session
        // room. Drop the memory rather than failing the SQS message.
        this.logger.warn(
          `Scenario session not found for session memory: ${room_id}`,
        );
        return;
      }

      // Outer message timestamp is unix seconds.
      const receivedAt = data.timestamp
        ? new Date(data.timestamp * 1000)
        : undefined;
      await this.scenarioSessionService.addSessionMemory(
        scenarioSession,
        sessionMemory,
        receivedAt,
      );
      this.logger.debug(
        `Session memory saved: session=${scenarioSession.id} ` +
          `chars=${sessionMemory.summary.length} ` +
          `coverage=${sessionMemory.summarized_message_count ?? '?'}/${
            sessionMemory.message_count ?? '?'
          }`,
      );

      // Track consolidation: when the session belongs to a track (directly
      // or through a nested case), fold this memory into the enrollment's
      // evolving learner memory. Detached and best-effort — folding must
      // never fail or delay the SQS message.
      void this.foldIntoTrackMemory(
        scenarioSession,
        sessionMemory.summary,
        sessionMemory.structured,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process session memory for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /** Resolve the session's track progress row (roleplay or nested case) and fold. */
  private async foldIntoTrackMemory(
    scenarioSession: {
      id: string;
      trackItemProgressId?: string;
      caseSessionItemId?: string;
    },
    summary: string,
    structured?: Record<string, any>,
  ): Promise<void> {
    try {
      let progressId = scenarioSession.trackItemProgressId ?? null;
      if (!progressId && scenarioSession.caseSessionItemId) {
        const caseSessionId =
          await this.caseSharedService.getCaseSessionIdBySessionItemId(
            scenarioSession.caseSessionItemId,
          );
        if (caseSessionId) {
          progressId =
            await this.trackProgressService.getProgressIdByCaseSessionId(
              caseSessionId,
            );
        }
      }
      if (!progressId) return;
      const disclosures = Array.isArray(structured?.disclosures)
        ? structured!.disclosures.filter((d: unknown) => typeof d === 'string')
        : undefined;
      await this.trackMemoryService.foldSessionMemory({
        trackItemProgressId: progressId,
        scenarioSessionId: scenarioSession.id,
        summary,
        disclosures,
      });
    } catch (error) {
      this.logger.error(
        `Track memory fold failed for session ${scenarioSession.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
