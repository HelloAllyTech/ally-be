import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';

import { AnalyticsSuggestion } from '../entity/analytics-suggestion.entity';
import {
  AnalyticsSuggestionStatus,
  AnalyticsSuggestionStatusFilter,
} from '../enum/analytics-suggestion.enum';
import { SUGGESTION_CONTEXT_LIMITS } from '../constants/analytics-suggestions.constants';

@Injectable()
export class AnalyticsSuggestionRepository extends Repository<AnalyticsSuggestion> {
  constructor(dataSource: DataSource) {
    super(AnalyticsSuggestion, dataSource.createEntityManager());
  }

  /**
   * The review queue, newest first.
   *
   * Ordered by createdAt DESC and then batch — the surface groups consecutive
   * rows by batchId, so rows from one run must stay adjacent. `id` breaks ties
   * because two rows from the same run share a createdAt to the millisecond and
   * an unstable sort would let a batch interleave with its neighbour.
   */
  listByStatus(
    status: AnalyticsSuggestionStatusFilter,
  ): Promise<AnalyticsSuggestion[]> {
    return this.find({
      where:
        status === 'all' ? {} : { status: status as AnalyticsSuggestionStatus },
      order: { createdAt: 'DESC', batchId: 'DESC', id: 'ASC' },
    });
  }

  /**
   * Recently rejected suggestions, for the next generation's prompt. Each is a
   * standing decision the model is told not to re-argue.
   */
  findRecentRejected(
    limit = SUGGESTION_CONTEXT_LIMITS.REJECTED,
  ): Promise<AnalyticsSuggestion[]> {
    return this.find({
      where: { status: AnalyticsSuggestionStatus.REJECTED },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Suggestions that are still open or already filed — the "already proposed"
   * block. Rejected rows are excluded here because they are listed separately
   * with their reasons.
   */
  findRecentOpenOrAccepted(
    limit = SUGGESTION_CONTEXT_LIMITS.ALREADY_PROPOSED,
  ): Promise<AnalyticsSuggestion[]> {
    return this.find({
      where: {
        status: In([
          AnalyticsSuggestionStatus.PENDING,
          AnalyticsSuggestionStatus.ACCEPTED,
        ]),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Move a suggestion out of PENDING, atomically.
   *
   * The status is part of the WHERE clause, so two reviewers acting on the same
   * card in two tabs cannot both win: the second update matches nothing and the
   * caller answers 409. A read-then-write would let both pass the check and file
   * the opportunity twice.
   *
   * Returns true when this call was the one that claimed the row.
   */
  async claimFromPending(
    id: string,
    patch: {
      status: AnalyticsSuggestionStatus;
      updatedBy: number;
      rejectedReason?: string | null;
    },
  ): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(AnalyticsSuggestion)
      .set({
        status: patch.status,
        updatedBy: patch.updatedBy,
        ...(patch.rejectedReason !== undefined
          ? { rejectedReason: patch.rejectedReason }
          : {}),
      })
      .where('id = :id AND status = :pending', {
        id,
        pending: AnalyticsSuggestionStatus.PENDING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Undo a claim after the work it was claimed for failed. Guarded on the status
   * it was claimed into, so a compensating write can never clobber a decision
   * someone else made in the meantime.
   */
  async revertClaim(
    id: string,
    claimedAs: AnalyticsSuggestionStatus,
  ): Promise<void> {
    await this.createQueryBuilder()
      .update(AnalyticsSuggestion)
      .set({ status: AnalyticsSuggestionStatus.PENDING })
      .where('id = :id AND status = :claimedAs', { id, claimedAs })
      .execute();
  }
}
