import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../constants/judge-scheduling.constants';
import { describeJudgeFailure } from '../util/judge-attempts.util';

/**
 * Writes the judge attempt ledger (`judge_attempts`, see JudgeAttempt). The
 * READ side is not here: scheduled selectors fold `judgeAttemptGate` into
 * their own query, so skipping a subject costs no extra round trip.
 *
 * Neither method throws. The ledger is advisory — losing a write costs at
 * worst one extra retry — and both are called from inside a judge job's
 * per-subject loop, where a throw would abort the whole run.
 */
@Injectable()
export class JudgeAttemptRepository {
  private readonly logger = LoggerService.getInstance(
    JudgeAttemptRepository.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Count one attempt that produced no judgment.
   *
   * `reason` is either the caught error — reduced to a PHI-free label by
   * `describeJudgeFailure` — or a fixed string the caller wrote itself.
   */
  async recordFailure(
    family: JudgeAttemptFamily,
    subjectId: string,
    tenantId: string | null | undefined,
    outcome: JudgeAttemptOutcome,
    reason: unknown,
  ): Promise<void> {
    const lastError =
      typeof reason === 'string'
        ? reason.slice(0, 120)
        : describeJudgeFailure(reason);
    try {
      await this.dataSource.query(
        `INSERT INTO judge_attempts
           ("family", "subjectId", "tenant_id", "attempts", "lastOutcome",
            "lastError", "lastAttemptAt")
         VALUES ($1, $2, $3, 1, $4, $5, now())
         ON CONFLICT ("family", "subjectId") DO UPDATE SET
           "attempts" = judge_attempts."attempts" + 1,
           "lastOutcome" = EXCLUDED."lastOutcome",
           "lastError" = EXCLUDED."lastError",
           "lastAttemptAt" = now(),
           "updatedAt" = now()`,
        [family, subjectId, tenantId ?? null, outcome, lastError],
      );
    } catch (e) {
      this.logger.warn(
        `judge attempt ledger: could not record ${family} ${subjectId}: ${
          (e as Error).message
        }`,
      );
    }
  }

  /** Forget a subject's failures once it has been judged. */
  async clear(family: JudgeAttemptFamily, subjectId: string): Promise<void> {
    try {
      await this.dataSource.query(
        `DELETE FROM judge_attempts WHERE "family" = $1 AND "subjectId" = $2`,
        [family, subjectId],
      );
    } catch (e) {
      this.logger.warn(
        `judge attempt ledger: could not clear ${family} ${subjectId}: ${
          (e as Error).message
        }`,
      );
    }
  }
}
