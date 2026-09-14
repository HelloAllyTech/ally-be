import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderAttemptRepository } from '../repository/builder-build.repository';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';

/** `code-3` → 3. Anything else is not a coding attempt and is ignored. */
const CODE_PHASE = /^code-(\d+)$/;

/**
 * Recording what each coding attempt decided, ran and returned.
 *
 * The training set for model selection, written as a byproduct of reporting
 * that already happens — the runner posts per-phase cost and gate verdicts
 * regardless, so this adds a row, not a round trip.
 *
 * Everything here is best-effort and must stay that way. A build is not worth
 * failing because its telemetry did not land, and the moment this can break a
 * run it becomes something to switch off rather than something to trust.
 */
@Injectable()
export class BuilderAttemptService {
  private readonly logger = LoggerService.getInstance(
    BuilderAttemptService.name,
  );

  constructor(private readonly repository: BuilderAttemptRepository) {}

  /**
   * The arm, from a phase-cost report.
   *
   * `escalated` is derived here rather than trusted from the runner: it is
   * simply whether this model differs from the previous attempt's, and the
   * previous attempt's row is the only place that is known for certain after
   * the fact.
   */
  async recordArm(
    run: BuilderBuildRun,
    phase: string,
    cost: {
      model?: string | null;
      totalCostUsd?: number | null;
      durationMs?: number | null;
      numTurns?: number | null;
    },
  ): Promise<void> {
    const match = CODE_PHASE.exec(phase ?? '');
    if (!match || !cost?.model) return;
    const attempt = Number(match[1]);
    if (!Number.isInteger(attempt) || attempt < 1) return;

    try {
      const previous =
        attempt > 1
          ? await this.repository.findOne({
              where: { runId: run.id, phase: 'code', attempt: attempt - 1 },
            })
          : null;

      await this.repository.upsert(
        {
          runId: run.id,
          sessionId: run.sessionId,
          attempt,
          phase: 'code',
          engine: run.engine ?? null,
          model: cost.model,
          ladderIndex: attempt - 1,
          escalated: Boolean(previous && previous.model !== cost.model),
          costUsd:
            cost.totalCostUsd === null || cost.totalCostUsd === undefined
              ? null
              : String(cost.totalCostUsd),
          durationMs: cost.durationMs ?? null,
          numTurns: cost.numTurns ?? null,
        },
        ['runId', 'phase', 'attempt'],
      );
    } catch (error) {
      this.logger.warn(
        `Could not record attempt ${attempt} for run ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The immediate reward, from the gate.
   *
   * Attributed to the newest attempt on the run, because the gate runs
   * directly after a coding pass and carries no attempt number of its own.
   * One gate run emits a verdict per repo, so a multi-repo build lands here
   * several times: the attempt passed only if every repo passed, and the
   * failure count accumulates. Hence read-modify-write rather than a blind set.
   *
   * A passing gate also marks the attempt as the one whose diff shipped —
   * nothing after it changes the code, so it is the only attempt the delayed
   * reward can honestly be credited to.
   */
  async recordGate(
    run: BuilderBuildRun,
    result: { passed: boolean; newFailures?: unknown; trusted?: boolean },
  ): Promise<void> {
    try {
      const current = await this.repository.findNewest(run.id);
      if (!current) return;

      const failures = Array.isArray(result.newFailures)
        ? result.newFailures.length
        : 0;
      const passed = current.gatePassed === false ? false : result.passed;
      // Untrusted once, untrusted for the attempt: a multi-repo build that
      // edited one repo's jest config has an unverifiable pass overall, even
      // if the other repos were clean.
      const trusted =
        current.gateTrusted === false ? false : result.trusted !== false;

      await this.repository.update(
        { id: current.id },
        {
          gatePassed: passed,
          gateTrusted: trusted,
          newFailureCount: (current.newFailureCount ?? 0) + failures,
          // A pass nobody can trust is not evidence this attempt's diff was
          // good, so it does not get to own the delayed reward either.
          producedFinalDiff: passed && trusted,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not record gate outcome for run ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
