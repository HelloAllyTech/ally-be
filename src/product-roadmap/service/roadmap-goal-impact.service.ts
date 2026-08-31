import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import {
  GoalImpactVerdict,
  RoadmapGoalImpactRepository,
  RoadmapStrategyGoalRepository,
} from '../repository/roadmap-strategy.repository';
import { ROADMAP_RANK } from '../constants/product-roadmap.constants';
import { RoadmapAiService } from './roadmap-ai.service';
import { RoadmapNotificationService } from './roadmap-notification.service';

/** What a bulk run did, and what is left. */
export interface BulkAssessResult {
  assessed: number;
  failed: number;
  /** Still missing at least one verdict after this run — the caller may run again. */
  remaining: number;
}

/**
 * Produces and stores the strategy-goal impact verdicts the composite rank's fourth factor
 * divides by.
 *
 * ## When this runs, and why not more often
 *
 * Assessment is billed, so it runs at the two moments the answer can actually have changed, and
 * on explicit request:
 *
 *   - ON FILE — a new opportunity has no verdicts and would otherwise rank at zero coverage.
 *   - ON DESCRIPTION EDIT — the verdicts were judged against text that no longer exists.
 *   - ON DEMAND — the drawer's Reassess action, and the settings bulk run.
 *
 * It deliberately does NOT run automatically when the strategy changes. Adding a goal makes
 * every rankable opportunity stale at once, and re-billing the entire board as a side effect of
 * typing a goal name is not a cost anyone opted into. Instead the staleness is COUNTED and
 * surfaced (`countNeedingAssessment`), and an admin triggers the catch-up. This is the one
 * place the design chooses a visible gap over an invisible bill.
 *
 * ## Failure is never fatal to the write that triggered it
 *
 * Every automatic call is best-effort: an opportunity that cannot be assessed still files, still
 * appears, and simply ranks with zero coverage until someone re-runs it. A model outage must not
 * be able to block the board's write path — the same rule the vector-indexing path follows.
 */
@Injectable()
export class RoadmapGoalImpactService {
  private readonly logger = LoggerService.getInstance(
    RoadmapGoalImpactService.name,
  );

  constructor(
    private readonly goalRepository: RoadmapStrategyGoalRepository,
    private readonly impactRepository: RoadmapGoalImpactRepository,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly aiService: RoadmapAiService,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /** One opportunity's stored verdicts, for the drawer breakdown. */
  listForOpportunity(opportunityId: string): Promise<GoalImpactVerdict[]> {
    return this.impactRepository.findForOpportunity(opportunityId);
  }

  /**
   * Assess one opportunity against the current strategy and store the result.
   *
   * Throws on a genuinely missing opportunity (a caller bug) but returns an empty array when
   * there is simply no strategy defined yet — that is a legitimate state on day one, not an
   * error, and the composite rank already degrades to the other three factors when the goal
   * count is zero.
   */
  async assess(
    opportunityId: string,
    actorId: number,
  ): Promise<GoalImpactVerdict[]> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    const goals = await this.goalRepository.findAllOrdered();
    if (!goals.length) return [];

    const verdicts = await this.aiService.assessGoalImpact(
      opportunity.description,
      goals.map((g) => g.name),
    );
    await this.impactRepository.replaceForOpportunity(opportunityId, verdicts);

    // The score changed, so every card's relative position may have. Board-wide rather than a
    // per-row delta for the same reason a weight change is: the normalisation bases are maxima,
    // so one row's new score can move everything else.
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId,
      reason: 'goals',
    });

    return this.impactRepository.findForOpportunity(opportunityId);
  }

  /**
   * Best-effort assessment for the write paths (file, and description edit).
   *
   * Awaited but never allowed to throw: the row is already committed by the time this runs, so
   * a model failure here would fail a request whose work is already done. Mirrors how the
   * vector-indexing call is treated on the same paths.
   */
  async assessQuietly(opportunityId: string, actorId: number): Promise<void> {
    try {
      await this.assess(opportunityId, actorId);
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Goal-impact assessment failed for ${opportunityId}; ` +
          `it will rank with zero coverage until reassessed. ${String(error)}`,
      );
    }
  }

  /**
   * Catch up opportunities missing a verdict for at least one live goal.
   *
   * SEQUENTIAL, not parallel. These are whole-description LLM calls and a bulk run exists
   * precisely because a goal was just added to a board of hundreds — firing them concurrently
   * is how you take the rate limit down for every other roadmap feature at once. The run is
   * bounded and reports what remains, so the honest answer to a big backlog is several clicks
   * rather than one request that appears to do everything and quietly truncates.
   *
   * One failure does not abort the run: a single unassessable description should not block the
   * other twenty-four.
   */
  async assessMissing(
    actorId: number,
    limit = ROADMAP_RANK.BULK_ASSESS_LIMIT,
  ): Promise<BulkAssessResult> {
    const goals = await this.goalRepository.findAllOrdered();
    if (!goals.length) return { assessed: 0, failed: 0, remaining: 0 };

    const ids = await this.impactRepository.findNeedingAssessment(limit);
    let assessed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.assess(id, actorId);
        assessed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `[ROADMAP] Bulk goal-impact assessment failed for ${id}: ${String(error)}`,
        );
      }
    }

    return {
      assessed,
      failed,
      remaining: await this.impactRepository.countNeedingAssessment(),
    };
  }

  /** How many rankable opportunities are missing at least one verdict. */
  countNeedingAssessment(): Promise<number> {
    return this.impactRepository.countNeedingAssessment();
  }
}
