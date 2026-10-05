import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import {
  LearnMessageAndEventMessage,
  LearnSessionMemoryData,
} from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { PreviewMonologueService } from '../service/preview-monologue.service';
import { RedisService } from 'src/redis/service/redis.service';

/**
 * How long a partial-coverage delivery waits before folding whatever memory is
 * stored by then. ally-ai-learn's phase-2 upgrade follows phase 1 within the
 * agent's shutdown drain (~16s), so a minute leaves room for SQS latency.
 */
export const PARTIAL_MEMORY_FOLD_DELAY_MS = 60_000;

/**
 * Lifetime of the "this session has been folded" marker. Every delivery for a
 * session lands within minutes of its end; a day comfortably outlives SQS
 * redrives without keeping keys around forever.
 */
export const TRACK_MEMORY_FOLD_GUARD_TTL_SECONDS = 24 * 60 * 60;

const foldGuardKey = (scenarioSessionId: string) =>
  `track-memory-fold:${scenarioSessionId}`;

/**
 * Whether a delivery is the session's final word, i.e. safe to fold now.
 *
 * ally-ai-learn ships `session_memory` up to three times per session: a
 * working-memory-only record (0/0, placeholder summary), phase 1 (the
 * maintained summary, which can leave an uncovered tail), then — only if the
 * final compaction succeeds — phase 2 covering every message. A delivery
 * without coverage fields comes from an agent that sent once per session, so
 * it is final. A 0-message delivery is the placeholder: never final, or it
 * would claim the session's one fold ahead of the real summary.
 */
export function isFinalSessionMemory(memory: LearnSessionMemoryData): boolean {
  const total = memory.message_count;
  const covered = memory.summarized_message_count;
  if (total == null || covered == null) return true;
  return total > 0 && covered >= total;
}

/**
 * Persists the agent's end-of-session episodic memory (message_type
 * "session_memory", up to three deliveries per session — see
 * isFinalSessionMemory) from ally-ai-learn onto the
 * scenario_session_details row (sessionMemory jsonb, atomic upsert). This is
 * the durable source getPreviousCaseMemory prefers when building the next
 * case session's previousMemory. Mirrors TurnMetricsProcessor: resolve the
 * session by room_id, no-op when the session isn't found. Previews have no
 * session row: they keep only their internal monologue (PreviewMonologueService).
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
    private readonly previewMonologueService: PreviewMonologueService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.SESSION_MEMORY;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const sessionMemory = learnData?.session_memory;

    // Previews are ephemeral and have no persisted session, so there is
    // nothing to attach episodic memory to. The internal monologue is the one
    // exception — an admin preview is exactly where someone wants to reopen
    // the run later and work out why the client behaved as it did.
    if (room_id.startsWith('preview-')) {
      const turns = sessionMemory?.structured?.client_working_memory?.monologue;
      if (Array.isArray(turns) && turns.length > 0) {
        await this.previewMonologueService.recordMonologue(room_id, turns);
      }
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
      const stored = await this.scenarioSessionService.addSessionMemory(
        scenarioSession,
        sessionMemory,
        receivedAt,
      );
      const coverage = `${sessionMemory.summarized_message_count ?? '?'}/${
        sessionMemory.message_count ?? '?'
      }`;
      if (!stored) {
        // A memory covering more messages is already stored, and was (or
        // will be) folded on its own delivery.
        this.logger.debug(
          `Session memory superseded, not stored: session=${scenarioSession.id} coverage=${coverage}`,
        );
        return;
      }
      this.logger.debug(
        `Session memory saved: session=${scenarioSession.id} ` +
          `chars=${sessionMemory.summary.length} coverage=${coverage}`,
      );

      // Track consolidation: when the session belongs to a track (directly
      // or through a nested case), fold this memory into the enrollment's
      // evolving learner memory. Detached and best-effort — folding must
      // never fail or delay the SQS message.
      void this.foldIntoTrackMemory(scenarioSession, sessionMemory);
    } catch (error) {
      this.logger.error(
        `Failed to process session memory for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Fold a session into its track memory once. Each fold is two LLM calls
   * (narrative + facts), and the agent's deliveries for one session would
   * otherwise each pay for one that the next immediately supersedes.
   *
   * A final delivery folds now. A partial one (phase 1, the working-memory
   * placeholder) waits PARTIAL_MEMORY_FOLD_DELAY_MS for phase 2, then folds
   * whatever is stored by then. Either way the fold first claims a per-session
   * Redis marker, so the deferred fold, a final delivery and any redelivery
   * can never fold the same session twice.
   *
   * Trade-offs. The deferral is an in-process timer, as in
   * ScenarioSessionEvaluationService.scheduleV2VEvaluation: a pod restart
   * inside the window drops that fold, so a session with no phase 2 then never
   * reaches its track memory (its own memory is still stored and still feeds
   * the next case session). There is no delayed-job queue to hand it to — the
   * SQS delay mechanism (AudioRetryProducer) needs a queue of its own, and the
   * scheduler only runs fixed crons. And the marker is claimed before the fold,
   * so a fold that fails inside TrackMemoryService (which swallows its errors)
   * is not retried by a later delivery.
   */
  private async foldIntoTrackMemory(
    scenarioSession: {
      id: string;
      tenantId: string;
      trackItemProgressId?: string;
      caseSessionItemId?: string;
    },
    memory: LearnSessionMemoryData,
  ): Promise<void> {
    try {
      const progressId = await this.resolveTrackProgressId(scenarioSession);
      if (!progressId) return;

      if (isFinalSessionMemory(memory)) {
        await this.foldOnce(
          progressId,
          scenarioSession.id,
          memory.summary,
          memory.structured,
        );
        return;
      }

      const timer = setTimeout(() => {
        void this.foldStoredMemory(progressId, scenarioSession);
      }, PARTIAL_MEMORY_FOLD_DELAY_MS);
      // A pending fold must not hold the process open through a shutdown.
      timer.unref?.();
    } catch (error) {
      this.logger.error(
        `Track memory fold failed for session ${scenarioSession.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** The deferred fold: whatever memory won the coverage guard by now. */
  private async foldStoredMemory(
    progressId: string,
    scenarioSession: { id: string; tenantId: string },
  ): Promise<void> {
    try {
      const stored = await this.scenarioSessionService.getStoredSessionMemory(
        scenarioSession.id,
        scenarioSession.tenantId,
      );
      if (!stored?.summary?.trim()) return;
      await this.foldOnce(
        progressId,
        scenarioSession.id,
        stored.summary,
        stored.structured ?? undefined,
      );
    } catch (error) {
      this.logger.error(
        `Deferred track memory fold failed for session ${scenarioSession.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async foldOnce(
    progressId: string,
    scenarioSessionId: string,
    summary: string,
    structured?: Record<string, any>,
  ): Promise<void> {
    if (!(await this.claimFold(scenarioSessionId))) {
      this.logger.debug(
        `Track memory already folded for session ${scenarioSessionId}; skipping`,
      );
      return;
    }
    const disclosures = Array.isArray(structured?.disclosures)
      ? structured!.disclosures.filter((d: unknown) => typeof d === 'string')
      : undefined;
    await this.trackMemoryService.foldSessionMemory({
      trackItemProgressId: progressId,
      scenarioSessionId,
      summary,
      disclosures,
    });
  }

  /**
   * SET NX on the session's fold marker. Fails open: with Redis down a
   * session may fold more than once, which is what happened on every delivery
   * before the marker existed — better than losing the learner's memory.
   */
  private async claimFold(scenarioSessionId: string): Promise<boolean> {
    try {
      return await this.redisService.acquireLock(
        foldGuardKey(scenarioSessionId),
        TRACK_MEMORY_FOLD_GUARD_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Track memory fold guard unavailable for session ${scenarioSessionId}; folding anyway: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /** The session's track progress row: a track roleplay, or a case nested in a track. */
  private async resolveTrackProgressId(scenarioSession: {
    trackItemProgressId?: string;
    caseSessionItemId?: string;
  }): Promise<string | null> {
    if (scenarioSession.trackItemProgressId) {
      return scenarioSession.trackItemProgressId;
    }
    if (!scenarioSession.caseSessionItemId) return null;
    const caseSessionId =
      await this.caseSharedService.getCaseSessionIdBySessionItemId(
        scenarioSession.caseSessionItemId,
      );
    if (!caseSessionId) return null;
    return this.trackProgressService.getProgressIdByCaseSessionId(
      caseSessionId,
    );
  }
}
