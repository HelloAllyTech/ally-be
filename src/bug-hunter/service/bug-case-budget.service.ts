import { ForbiddenException, Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  BugCaseBudget,
  BugCaseBudgetKind,
  chargeBudget,
  explainSessionRefusal,
  overrideBudget,
  withBudgetDefaults,
} from '../type/bug-case-budget.type';

/**
 * Owns the `budget` column on a finding — see `BugCaseBudget` for why it
 * exists. Three jobs: read it with defaults applied, charge a move against
 * it, and refuse a session start once a cap is reached unless a person says
 * otherwise.
 *
 * Charging is best-effort and never awaited on a path that must not fail:
 * an event that cannot be metered is still an event. The gate is the one
 * place this service throws, and it throws with the sentence the admin
 * reads.
 */
@Injectable()
export class BugCaseBudgetService {
  private readonly logger = LoggerService.getInstance(
    BugCaseBudgetService.name,
  );

  constructor(private readonly findingRepository: BugFindingRepository) {}

  read(finding: Pick<BugFinding, 'budget'>): BugCaseBudget {
    return withBudgetDefaults(finding.budget ?? null);
  }

  async get(findingId: string): Promise<BugCaseBudget | null> {
    const finding = await this.findingRepository.findOne({
      where: { id: findingId },
      select: ['id', 'budget'],
    });
    return finding ? this.read(finding) : null;
  }

  /**
   * Spend `amount` of `kind` on a finding. Swallows failures: metering must
   * never break the move it meters.
   */
  async charge(
    findingId: string,
    kind: BugCaseBudgetKind,
    amount: number,
  ): Promise<BugCaseBudget | null> {
    if (!(amount > 0)) return null;
    try {
      const finding = await this.findingRepository.findOne({
        where: { id: findingId },
        select: ['id', 'budget'],
      });
      if (!finding) return null;
      const next = chargeBudget(this.read(finding), kind, amount);
      await this.findingRepository.update(findingId, {
        budget: next as unknown as Record<string, any>,
      });
      if (next.exhausted && !this.read(finding).exhausted) {
        this.logger.info(
          `[BUG_HUNTER] Finding ${findingId} has reached its ${next.exhausted.kind} budget ` +
            `(${next.used[next.exhausted.kind]} of ${next.caps[next.exhausted.kind]}).`,
        );
      }
      return next;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not charge ${amount} ${kind} to finding ${findingId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Charge the same amount to every finding a run worked on. A fix-session
   * run has exactly one; a sweep run has none that this meters (its cost is
   * the sweep's, not any bug's).
   */
  async chargeRun(
    runId: string,
    kind: BugCaseBudgetKind,
    amount: number,
  ): Promise<void> {
    if (!(amount > 0)) return;
    try {
      const findings = await this.findingRepository.find({
        where: { runId },
        select: ['id'],
      });
      for (const f of findings) await this.charge(f.id, kind, amount);
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not charge run ${runId}'s ${kind} to its findings: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The gate. Throws a 403 with the admin-facing sentence when any cap is
   * reached, unless `force` — in which case the override is recorded on the
   * budget and the session may start.
   */
  async assertCanStartSession(
    finding: BugFinding,
    options: { force?: boolean; userId: number | null },
  ): Promise<void> {
    const budget = this.read(finding);
    const refusal = explainSessionRefusal(budget);
    if (!refusal) return;
    if (!options.force || options.userId == null) {
      throw new ForbiddenException(refusal);
    }
    await this.findingRepository.update(finding.id, {
      budget: overrideBudget(budget, options.userId) as unknown as Record<
        string,
        any
      >,
    });
    this.logger.info(
      `[BUG_HUNTER] User ${options.userId} started a session on finding ${finding.id} past its budget.`,
    );
  }
}
