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
import { RoadmapVoteGrantRepository } from '../repository/roadmap-vote-grant.repository';
import { ROADMAP_VOTE_BALANCE_EXCEEDED_MARKER } from '../constants/product-roadmap.constants';
import { currentPeriodKey } from '../util/roadmap-period.util';
import {
  VoteBudgetDto,
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
    private readonly grantRepository: RoadmapVoteGrantRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /** The caller's live, spendable vote balance. */
  async getBudget(userId: number): Promise<VoteBudgetDto> {
    const available = await this.grantRepository.availableBalance(
      this.dataSource.manager,
      userId,
    );
    return { available };
  }

  /**
   * Set (or clear) the caller's votes on one opportunity for the CURRENT period.
   *
   * One idempotent operation replaces the source client's delete-vs-upsert branch:
   * `votes: 0` deletes the row rather than storing a zero, so "no vote" has exactly one
   * representation and every SUM stays honest.
   *
   * Concurrency: the advisory lock is taken FIRST, before reading the balance. Without it two
   * debounced writes from the same person in two tabs both read a stale balance, both pass
   * this check, and the DB trigger then rejects one with a 500-shaped error instead of a clean
   * 422.
   *
   * ORDERING WITHIN THE TRANSACTION: the roadmap_allocations write happens BEFORE
   * grantRepository.consume()/refund(). The DB trigger validates a positive delta against the
   * live grant balance at the instant the allocations row is written — if consume() ran first,
   * that same spend would already be missing from the balance the trigger reads, double
   * counting the request against itself. See migration 1962100000000's docblock for the full
   * reasoning; don't reorder these two steps.
   */
  async setVotes(
    userId: number,
    opportunityId: string,
    votes: number,
  ): Promise<SetAllocationResponseDto> {
    const periodKey = currentPeriodKey();

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.allocationRepository.lockUser(manager, userId);

        const opportunity = await manager.findOne(RoadmapOpportunity, {
          where: { id: opportunityId },
        });
        if (!opportunity) {
          throw new NotFoundException(`Opportunity ${opportunityId} not found`);
        }

        // The stage rule lives here rather than in a trigger precisely so that split and
        // merge can redistribute votes on opportunities that have already moved on. The
        // source needed a transaction-local GUC (app.bypass_stage_check) to defeat its
        // trigger; nothing here needs defeating.
        if (opportunity.stage !== RoadmapOpportunityStage.NEW) {
          throw new ConflictException(
            `Votes can only be added to opportunities in the "new" stage; ` +
              `this one is "${opportunity.stage}". Existing votes are kept.`,
          );
        }

        // Bug reports aren't voted on — they're triaged and fixed, not prioritised by
        // popularity. This only blocks NEW votes going forward; votes already cast on a
        // bug opportunity (e.g. migrated from the source app, or from before this rule)
        // are left in place.
        if (opportunity.type === RoadmapOpportunityType.BUG) {
          throw new ConflictException(
            `Votes can't be added to bug reports. Existing votes are kept.`,
          );
        }

        const existing = await manager.findOne(RoadmapAllocation, {
          where: { userId, opportunityId, periodKey },
        });
        const previousVotes = existing?.votes ?? 0;
        const delta = votes - previousVotes;

        if (delta > 0) {
          const available = await this.grantRepository.availableBalance(
            manager,
            userId,
          );
          if (delta > available) {
            throw new UnprocessableEntityException({
              message:
                `Not enough votes: you have ${available} available and this would spend ` +
                `${delta} more.`,
              available,
            });
          }
        }

        if (votes === 0) {
          if (existing) await manager.remove(RoadmapAllocation, existing);
        } else if (existing) {
          existing.votes = votes;
          await manager.save(RoadmapAllocation, existing);
        } else {
          await manager.save(
            manager.create(RoadmapAllocation, {
              userId,
              opportunityId,
              periodKey,
              votes,
            }),
          );
        }

        if (delta > 0) {
          await this.grantRepository.consume(manager, userId, delta);
        } else if (delta < 0) {
          await this.grantRepository.refund(manager, userId, -delta);
        }

        const [scoreRow] = await manager.query<{ total: string | null }[]>(
          `SELECT COALESCE(SUM(votes), 0) AS total FROM roadmap_allocations WHERE "opportunityId" = $1`,
          [opportunityId],
        );
        const priorityScore = Number(scoreRow?.total ?? 0);

        const available = await this.grantRepository.availableBalance(
          manager,
          userId,
        );
        const budget: VoteBudgetDto = { available };

        this.notifications.emit({
          kind: 'ALLOCATION_CHANGED',
          actorId: userId,
          opportunityId,
          periodKey,
          votes,
          priorityScore,
        });

        return { opportunityId, periodKey, votes, priorityScore, budget };
      });
    } catch (error) {
      throw this.translateBalanceError(error);
    }
  }

  /**
   * Map the DB trigger's breach into a 409 instead of letting it surface as a 500.
   *
   * This should be unreachable — the service checks the balance under the advisory lock — so
   * reaching it means either a writer that bypassed this service or a bug in the lock. Log it
   * loudly rather than swallowing it: a silently-translated 409 here would hide the fact that
   * the friendly path is broken.
   */
  private translateBalanceError(error: unknown): unknown {
    const message = (error as { message?: string })?.message ?? '';
    if (!message.includes(ROADMAP_VOTE_BALANCE_EXCEEDED_MARKER)) return error;

    this.logger.error(
      `[ROADMAP] Vote balance was enforced by the DB TRIGGER, not the service. ` +
        `That means a writer bypassed RoadmapAllocationService or the advisory lock failed. ${message}`,
    );
    return new ConflictException(
      'Not enough votes available. Refresh to see your current balance.',
    );
  }
}
