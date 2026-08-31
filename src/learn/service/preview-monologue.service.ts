import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PreviewMonologueRun } from '../entity/preview-monologue-run.entity';

/** `preview-<scenarioId>-<uuid>` — the only room shape that reaches this service. */
const PREVIEW_ROOM_PATTERN = /^preview-(\d+)-/;

export interface StartPreviewRunInput {
  roomName: string;
  scenarioId: number;
  scenarioVersionId?: string | null;
  languageId?: number | null;
  tenantId?: string | null;
  startedByUserId?: number | null;
}

export interface PreviewMonologueRunSummary {
  id: string;
  roomName: string;
  scenarioId: number;
  scenarioVersionId: string | null;
  languageId: number | null;
  startedByUserId: number | null;
  /** Who ran it. Resolved here so the list never renders a bare user id. */
  startedByName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  turnCount: number;
}

/**
 * Records admin-preview internal monologues so a curator can reopen a run and
 * work out why the client behaved as it did.
 *
 * Every write here is best-effort. A preview exists to test a scenario; losing
 * its monologue is annoying, failing to start it is not acceptable, so nothing
 * on the write path is allowed to throw into a caller.
 */
@Injectable()
export class PreviewMonologueService {
  private readonly logger = LoggerService.getInstance(
    PreviewMonologueService.name,
  );

  constructor(
    @InjectRepository(PreviewMonologueRun)
    private readonly repository: Repository<PreviewMonologueRun>,
  ) {}

  /** scenarioId out of a preview room name, or null if this isn't one. */
  static scenarioIdFromRoomName(roomName: string): number | null {
    const match = PREVIEW_ROOM_PATTERN.exec(roomName ?? '');
    return match ? Number(match[1]) : null;
  }

  /**
   * Open a run at preview start. Recorded even if the run goes on to produce
   * no monologue at all — "someone previewed this and got nothing" is itself
   * worth seeing, and it is the only place the who/when is known.
   */
  async startRun(input: StartPreviewRunInput): Promise<void> {
    try {
      await this.repository.upsert(
        {
          roomName: input.roomName,
          scenarioId: input.scenarioId,
          scenarioVersionId: input.scenarioVersionId ?? null,
          languageId: input.languageId ?? null,
          tenantId: input.tenantId ?? null,
          startedByUserId: input.startedByUserId ?? null,
          turns: [],
          turnCount: 0,
        },
        ['roomName'],
      );
    } catch (error) {
      this.logger.warn(
        `[PREVIEW_MONOLOGUE] could not open run for ${input.roomName}: ${error?.message}`,
      );
    }
  }

  /**
   * Attach the monologue the agent shipped at end of session.
   *
   * The agent sends the write-out twice by design (an early record-only ship,
   * then again with the summary attached), and the later one is at least as
   * complete — so a shorter payload never overwrites a longer one.
   */
  async recordMonologue(
    roomName: string,
    turns: Record<string, any>[],
    endedAt?: Date,
  ): Promise<void> {
    const scenarioId = PreviewMonologueService.scenarioIdFromRoomName(roomName);
    if (scenarioId === null) {
      return;
    }

    try {
      const existing = await this.repository.findOne({ where: { roomName } });

      if (existing && (existing.turnCount ?? 0) > turns.length) {
        return;
      }

      if (!existing) {
        // No open run: the preview predates this feature or the start-side
        // write lost a race. The monologue still has a home.
        await this.repository.upsert(
          {
            roomName,
            scenarioId,
            turns,
            turnCount: turns.length,
            endedAt: endedAt ?? new Date(),
          },
          ['roomName'],
        );
        return;
      }

      await this.repository.update(
        { roomName },
        { turns, turnCount: turns.length, endedAt: endedAt ?? new Date() },
      );
    } catch (error) {
      this.logger.warn(
        `[PREVIEW_MONOLOGUE] could not record ${turns.length} turns for ${roomName}: ${error?.message}`,
      );
    }
  }

  /** Newest runs for a scenario, without their turns. */
  async listRunsForScenario(
    scenarioId: number,
    limit = 50,
  ): Promise<PreviewMonologueRunSummary[]> {
    // Turns are deliberately not selected: a run holds up to 30 of them and
    // the list only needs to say which run to open.
    const rows = await this.repository
      .createQueryBuilder('run')
      .leftJoin('users', 'u', 'u.id = run."startedByUserId"')
      .select([
        'run.id AS id',
        'run."roomName" AS "roomName"',
        'run."scenarioId" AS "scenarioId"',
        'run."scenarioVersionId" AS "scenarioVersionId"',
        'run."languageId" AS "languageId"',
        'run."startedByUserId" AS "startedByUserId"',
        'run."createdAt" AS "startedAt"',
        'run."endedAt" AS "endedAt"',
        'run."turnCount" AS "turnCount"',
        'u.name AS "startedByName"',
      ])
      .where('run."scenarioId" = :scenarioId', { scenarioId })
      .orderBy('run."createdAt"', 'DESC')
      .limit(limit)
      .getRawMany<
        PreviewMonologueRunSummary & { turnCount: string | number }
      >();

    return rows.map((row) => ({
      ...row,
      turnCount: Number(row.turnCount ?? 0),
    }));
  }

  /** One run with its turns. */
  async getRun(id: string): Promise<PreviewMonologueRun> {
    const run = await this.repository.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Preview monologue run ${id} not found`);
    }
    return run;
  }
}
