import { Injectable } from '@nestjs/common';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { DataSource } from 'typeorm';

import { WmRecallSelection } from '../entity/wm-recall-selection.entity';
import { ScenarioSessionService } from '../service/scenario-session.service';

/** Cue sources recall can fall back through, mirroring its own ladder. */
const CUE_TIERS = ['nominated', 'learner_text', 'scenario', 'none'];

/** Candidates stored per turn on each side, matching the emitter's own caps. */
const MAX_ROWS_PER_SIDE = 20;

interface WmRecallMessage {
  message_type: string;
  room_id?: string;
  timestamp?: number;
  data?: {
    wm_recall?: {
      turn_index?: number;
      stance?: string;
      cue_tier?: string;
      cue_count?: number;
      pool_size?: number;
      cap?: number;
      selected?: Record<string, unknown>[];
      passed_over?: Record<string, unknown>[];
    };
  };
}

/**
 * Persists what the voice agent's working-memory recall considered on a turn (message_type
 * `wm_recall`).
 *
 * The scores existed all along — `recall.select` returns them, and says in its docstring that
 * they are what makes its coefficients "tunable from production rather than from argument" —
 * and the only call site discarded them every turn. This is the other end of that.
 *
 * Mirrors TurnMetricsProcessor: resolve the session by room, skip previews, drop the sample
 * rather than failing the message when the session is not found. Recall telemetry is
 * loss-tolerant; a retry-storm on this queue would cost live sessions their working memory,
 * which is a far worse trade than a missing row.
 *
 * IDEMPOTENT BY KEY, not by hope. The queue is at-least-once and this is a blind insert, so a
 * redelivered turn would otherwise double itself in every aggregate — the same defence turn
 * metrics needs. ON CONFLICT updates rather than ignores: a redelivery carries the same
 * decision, and if a later message for the same turn ever differed, the latest is the one that
 * describes what the client actually recalled.
 */
@Injectable()
export class WmRecallProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(WmRecallProcessor.name);

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.WM_RECALL;
  }

  private static toInt(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  private static rows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
      ? (value.slice(0, MAX_ROWS_PER_SIDE) as Record<string, unknown>[])
      : [];
  }

  async process(message: WmRecallMessage): Promise<void> {
    const roomId = message?.room_id;
    const event = message?.data?.wm_recall;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (!roomId || roomId.startsWith('preview-')) return;

    if (!event || event.turn_index == null) {
      this.logger.warn(
        `[WM_RECALL] payload missing turn_index (room=${roomId})`,
      );
      return;
    }

    // An unknown tier is stored as 'none' rather than as itself: the column is read as a
    // distribution, and a stray value would quietly become its own bucket.
    const cueTier = CUE_TIERS.includes(event.cue_tier ?? '')
      ? (event.cue_tier as string)
      : 'none';

    try {
      const session =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          roomId,
        );
      if (!session) {
        this.logger.warn(`[WM_RECALL] no session for room ${roomId}`);
        return;
      }

      await this.dataSource
        .getRepository(WmRecallSelection)
        .createQueryBuilder()
        .insert()
        .values({
          tenantId: session.tenantId,
          scenarioSessionId: session.id,
          turnIndex: WmRecallProcessor.toInt(event.turn_index),
          stance: event.stance || undefined,
          cueTier,
          cueCount: WmRecallProcessor.toInt(event.cue_count),
          poolSize: WmRecallProcessor.toInt(event.pool_size),
          cap: WmRecallProcessor.toInt(event.cap),
          // Cast because TypeORM's QueryDeepPartialEntity cannot express "an opaque jsonb
          // array"; the shape is the emitter's contract and is validated there.
          selected: WmRecallProcessor.rows(event.selected) as never,
          passedOver: WmRecallProcessor.rows(event.passed_over) as never,
        })
        .orUpdate(
          [
            'stance',
            'cue_tier',
            'cue_count',
            'pool_size',
            'cap',
            'selected',
            'passed_over',
          ],
          ['scenarioSessionId', 'turnIndex'],
        )
        .execute();
    } catch (error) {
      this.logger.warn(
        `[WM_RECALL] could not persist recall for room ${roomId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
