import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';

import { RoadmapAllocation } from '../entity/roadmap-allocation.entity';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import { RoadmapAllocationRepository } from '../repository/roadmap-allocation.repository';
import {
  COINS_PER_MONTH,
  ROADMAP_CAP_ERROR_MARKER,
} from '../constants/product-roadmap.constants';
import { currentPeriodKey } from '../util/roadmap-period.util';
import {
  CoinBudgetDto,
  SetAllocationResponseDto,
} from '../dto/roadmap-response.dto';
import { RoadmapNotificationService } from './roadmap-notification.service';

@Injectable()
export class RoadmapAllocationService {
  private readonly logger = LoggerService.getInstance(
    RoadmapAllocationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly allocationRepository: RoadmapAllocationRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /** The caller's remaining coins for the current period. */
  async getBudget(userId: number): Promise<CoinBudgetDto> {
    const periodKey = currentPeriodKey();
    const used = await this.allocationRepository.sumForPeriod(
      userId,
      periodKey,
    );
    return {
      periodKey,
      coinsPerMonth: COINS_PER_MONTH,
      used,
      remaining: Math.max(0, COINS_PER_MONTH - used),
    };
  }

  /**
   * Set (or clear) the caller's coins on one opportunity for the CURRENT period.
   *
   * One idempotent operation replaces the source client's delete-vs-upsert branch:
   * `coins: 0` deletes the row rather than storing a zero, so "no vote" has exactly one
   * representation and every SUM stays honest.
   *
   * Concurrency: the advisory lock is taken FIRST, before reading the total. Without it two
   * debounced writes from the same person in two tabs both read a stale sum, both pass this
   * check, and the DB trigger then rejects one with a 500-shaped error instead of a clean 422.
   */
  async setCoins(
    userId: number,
    opportunityId: string,
    coins: number,
  ): Promise<SetAllocationResponseDto> {
    const periodKey = currentPeriodKey();

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.allocationRepository.lockUserPeriod(
          manager,
          userId,
          periodKey,
        );

        const opportunity = await manager.findOne(RoadmapOpportunity, {
          where: { id: opportunityId },
        });
        if (!opportunity) {
          throw new NotFoundException(`Opportunity ${opportunityId} not found`);
        }

        // The stage rule lives here rather than in a trigger precisely so that split and
        // merge can redistribute coins on opportunities that have already moved on. The
        // source needed a transaction-local GUC (app.bypass_stage_check) to defeat its
        // trigger; nothing here needs defeating.
        if (opportunity.stage !== RoadmapOpportunityStage.NEW) {
          throw new ConflictException(
            `Coins can only be allocated to opportunities in the "new" stage; ` +
              `this one is "${opportunity.stage}". Existing votes are kept.`,
          );
        }

        // Bug reports aren't coin-voted — they're triaged and fixed, not prioritised by
        // popularity. This only blocks NEW allocations going forward; coins already
        // allocated to a bug opportunity (e.g. migrated from the source app, or from
        // before this rule) are left in place.
        if (opportunity.type === RoadmapOpportunityType.BUG) {
          throw new ConflictException(
            `Coins can't be allocated to bug reports. Existing votes are kept.`,
          );
        }

        const existing = await manager.findOne(RoadmapAllocation, {
          where: { userId, opportunityId, periodKey },
        });

        const usedElsewhere =
          await this.allocationRepository.sumForPeriodExcluding(
            manager,
            userId,
            periodKey,
            opportunityId,
          );

        if (usedElsewhere + coins > COINS_PER_MONTH) {
          throw new UnprocessableEntityException({
            message:
              `Monthly coin cap exceeded: you have ${usedElsewhere} of ${COINS_PER_MONTH} ` +
              `coins committed elsewhere in ${periodKey}.`,
            remaining: Math.max(0, COINS_PER_MONTH - usedElsewhere),
            cap: COINS_PER_MONTH,
            periodKey,
          });
        }

        if (coins === 0) {
          if (existing) await manager.remove(RoadmapAllocation, existing);
        } else if (existing) {
          existing.coins = coins;
          await manager.save(RoadmapAllocation, existing);
        } else {
          await manager.save(
            manager.create(RoadmapAllocation, {
              userId,
              opportunityId,
              periodKey,
              coins,
            }),
          );
        }

        const [scoreRow] = await manager.query<{ total: string | null }[]>(
          `SELECT COALESCE(SUM(coins), 0) AS total FROM roadmap_allocations WHERE "opportunityId" = $1`,
          [opportunityId],
        );
        const priorityScore = Number(scoreRow?.total ?? 0);

        const used = usedElsewhere + coins;
        const budget: CoinBudgetDto = {
          periodKey,
          coinsPerMonth: COINS_PER_MONTH,
          used,
          remaining: Math.max(0, COINS_PER_MONTH - used),
        };

        this.notifications.emit({
          kind: 'ALLOCATION_CHANGED',
          actorId: userId,
          opportunityId,
          periodKey,
          coins,
          priorityScore,
        });

        return { opportunityId, periodKey, coins, priorityScore, budget };
      });
    } catch (error) {
      throw this.translateCapError(error);
    }
  }

  /**
   * Map the DB trigger's breach into a 409 instead of letting it surface as a 500.
   *
   * This should be unreachable — the service checks the cap under the advisory lock — so
   * reaching it means either a writer that bypassed this service or a bug in the lock. Log it
   * loudly rather than swallowing it: a silently-translated 409 here would hide the fact that
   * the friendly path is broken.
   */
  private translateCapError(error: unknown): unknown {
    const message = (error as { message?: string })?.message ?? '';
    if (!message.includes(ROADMAP_CAP_ERROR_MARKER)) return error;

    this.logger.error(
      `[ROADMAP] Monthly cap was enforced by the DB TRIGGER, not the service. ` +
        `That means a writer bypassed RoadmapAllocationService or the advisory lock failed. ${message}`,
    );
    return new ConflictException(
      'Monthly coin cap exceeded. Refresh to see your current balance.',
    );
  }
}
