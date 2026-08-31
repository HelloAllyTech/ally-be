import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapStrategyGoal } from '../entity/roadmap-strategy-goal.entity';
import { RoadmapRankWeights } from '../entity/roadmap-rank-weights.entity';
import {
  RoadmapGoalImpactRepository,
  RoadmapRankWeightsRepository,
  RoadmapStrategyGoalRepository,
} from '../repository/roadmap-strategy.repository';
import { RankContext } from '../repository/roadmap-opportunity.repository';
import { ROADMAP_RANK } from '../constants/product-roadmap.constants';
import { RoadmapNotificationService } from './roadmap-notification.service';

/**
 * Product strategy goals and the composite-rank weights — the two things an admin tunes in
 * settings to change how the board ranks.
 *
 * The asymmetry between the two is the thing to keep in mind here: changing a WEIGHT is free
 * and instant (it is applied in SQL over factors that already exist), while adding a GOAL
 * invalidates every stored assessment against the new denominator and needs the model to catch
 * up. Every method below is written to make that difference visible rather than to hide it.
 */
@Injectable()
export class RoadmapStrategyGoalService {
  constructor(
    private readonly goalRepository: RoadmapStrategyGoalRepository,
    private readonly impactRepository: RoadmapGoalImpactRepository,
    private readonly weightsRepository: RoadmapRankWeightsRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  // ── strategy goals ─────────────────────────────────────────────────────────

  listGoals(): Promise<RoadmapStrategyGoal[]> {
    return this.goalRepository.findAllOrdered();
  }

  /**
   * Add a goal.
   *
   * Every existing opportunity is now unassessed against it, AND the coverage denominator has
   * grown — so every score on the board drops until a re-assessment runs. That is reported to
   * the caller (`unassessed`) rather than left for someone to notice, because the alternative
   * is a board that silently ranks everything lower and looks confident about it.
   */
  async createGoal(
    userId: number,
    name: string,
  ): Promise<{ goal: RoadmapStrategyGoal; unassessed: number }> {
    const trimmed = name.trim();
    if (await this.goalRepository.findOne({ where: { name: trimmed } })) {
      throw new ConflictException(
        `A strategy goal named "${trimmed}" already exists`,
      );
    }

    const count = await this.goalRepository.count();
    if (count >= ROADMAP_RANK.MAX_STRATEGY_GOALS) {
      throw new BadRequestException(
        `A strategy is at most ${ROADMAP_RANK.MAX_STRATEGY_GOALS} goals. ` +
          `Remove one before adding another — coverage means less the more goals it divides by.`,
      );
    }

    const saved = await this.goalRepository.save(
      this.goalRepository.create({ name: trimmed, position: count }),
    );
    this.invalidate(userId);
    return {
      goal: saved,
      unassessed: await this.goalRepository.countUnassessed(trimmed),
    };
  }

  /**
   * Rename. FREE: the FK on roadmap_opportunity_goal_impacts.goalName is ON UPDATE CASCADE, so
   * every stored verdict follows the new name and nothing needs re-assessing.
   *
   * That said, a rename that changes the goal's MEANING (not just its wording) leaves verdicts
   * that were judged against the old intent. The API cannot tell those apart, so the settings
   * UI offers a re-assess action next to rename rather than deciding for the admin.
   */
  async renameGoal(
    userId: number,
    id: string,
    nextName: string,
  ): Promise<RoadmapStrategyGoal> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Strategy goal ${id} not found`);

    const trimmed = nextName.trim();
    if (
      trimmed !== goal.name &&
      (await this.goalRepository.findOne({ where: { name: trimmed } }))
    ) {
      throw new ConflictException(
        `A strategy goal named "${trimmed}" already exists`,
      );
    }

    goal.name = trimmed;
    const saved = await this.goalRepository.save(goal);
    this.invalidate(userId);
    return saved;
  }

  /**
   * Delete. Does NOT block, unlike deleting a product-goal CATEGORY: the FK is ON DELETE
   * CASCADE, so the goal's verdicts go with it and coverage recomputes correctly against the
   * smaller denominator. No LLM calls, and nothing is stranded.
   *
   * The count of discarded verdicts is returned so the confirmation can say what is being
   * thrown away — assessments cost money to produce and deleting a goal is not reversible.
   */
  async deleteGoal(
    userId: number,
    id: string,
  ): Promise<{ discardedVerdicts: number }> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Strategy goal ${id} not found`);

    const discardedVerdicts = await this.impactRepository.count({
      where: { goalName: goal.name },
    });
    await this.goalRepository.remove(goal);
    this.invalidate(userId);
    return { discardedVerdicts };
  }

  async reorderGoals(userId: number, ids: string[]): Promise<void> {
    for (const [position, id] of ids.entries()) {
      await this.goalRepository.update({ id }, { position });
    }
    this.invalidate(userId);
  }

  /**
   * The live goal count — the coverage DENOMINATOR, sent on every opportunity so a client can
   * render "helps 2 of 4 goals" without a second request and without hardcoding a total that
   * changes whenever the strategy does.
   */
  countGoals(): Promise<number> {
    return this.goalRepository.count();
  }

  /** Per-goal "not yet assessed" counts, for the settings list. */
  getUnassessedCounts(): Promise<Record<string, number>> {
    return this.goalRepository.getUnassessedCounts();
  }

  // ── rank weights ───────────────────────────────────────────────────────────

  getWeights(): Promise<RoadmapRankWeights> {
    return this.weightsRepository.getWeights();
  }

  /**
   * Update the weights. Cheap by construction — no LLM calls, no stored score to rewrite, just
   * a different ORDER BY on the next read.
   *
   * The all-zero case is rejected here with a readable message as well as by the CHECK: a
   * constraint violation would surface as a 500, and "every weight is zero" is a mistake an
   * admin makes by clearing four inputs, not an attack.
   */
  async updateWeights(
    userId: number,
    patch: Partial<
      Pick<
        RoadmapRankWeights,
        'votesWeight' | 'votersWeight' | 'effortWeight' | 'goalImpactWeight'
      >
    >,
  ): Promise<RoadmapRankWeights> {
    const current = await this.weightsRepository.getWeights();
    const next = { ...current, ...patch };

    const total =
      next.votesWeight +
      next.votersWeight +
      next.effortWeight +
      next.goalImpactWeight;
    if (total <= 0) {
      throw new BadRequestException(
        'At least one factor must have a weight above zero, or there is nothing to rank by.',
      );
    }

    const saved = await this.weightsRepository.save(next);
    this.invalidate(userId);
    return saved;
  }

  /**
   * Weights + normalisation bases in one shot, for the read paths.
   *
   * Read ONCE PER REQUEST and passed down, never per row: the bases are maxima over the whole
   * board, so scoring rows in one page against different bases would break the ordering.
   */
  async getRankContext(): Promise<RankContext> {
    const [weights, bases] = await Promise.all([
      this.weightsRepository.getWeights(),
      this.weightsRepository.getRankBases(),
    ]);
    return {
      weights: {
        votesWeight: weights.votesWeight,
        votersWeight: weights.votersWeight,
        effortWeight: weights.effortWeight,
        goalImpactWeight: weights.goalImpactWeight,
      },
      bases,
    };
  }

  /**
   * A board-wide invalidation rather than a per-row delta: a goal or weight change reorders an
   * unbounded number of cards this service never sees.
   */
  private invalidate(userId: number): void {
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'goals',
    });
  }
}
