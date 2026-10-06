import { Injectable } from '@nestjs/common';

import {
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  MeasurementConvergenceQueryDto,
  MeasurementConvergenceResponseDto,
} from '../dto/measurement-convergence-analytics.dto';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
import { MeasurementConvergenceAnalyticsRepository } from '../repository/measurement-convergence-analytics.repository';
import {
  MIN_PAIRS_FOR_CONVERGENCE,
  MIN_SESSIONS_FOR_SCORE_Z,
  buildConvergence,
} from '../util/measurement-convergence.util';

const CAVEAT =
  'Agreement is not validity: two LLM-scored signals can agree and both be wrong — human ratings ' +
  '(AAQ-223) are the check. R2 and R3 also share inputs (the session score includes ' +
  'behaviour-instruction points), so part of their agreement is mechanical.';

/**
 * Highlights → Helping skills "Do the rulers agree?" (EFF-80, AAQ-222).
 *
 * Loads every scored cut once (rubric-pinned, org-scoped by the cut's own
 * tenant), looks up the sessions those cuts name and their scenario versions'
 * score distributions, and hands the lot to `measurement-convergence.util`.
 * Model-free: nothing here calls a model.
 */
@Injectable()
export class MeasurementConvergenceAnalyticsService {
  constructor(
    private readonly repository: MeasurementConvergenceAnalyticsRepository,
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getConvergence(
    query: MeasurementConvergenceQueryDto,
  ): Promise<MeasurementConvergenceResponseDto> {
    const rows = await this.cuts.getAllLearnerCuts(
      FHS_RUBRIC_VERSION,
      query.tenantId,
    );
    const sessionIds = [...new Set(rows.flatMap((r) => r.sessionIds))];
    const [sessions, stats] = await Promise.all([
      this.repository.getSessionSignals(sessionIds),
      this.repository.getVersionScoreStats(sessionIds),
    ]);
    const result = buildConvergence({
      cuts: rows.map((r) => ({
        userId: r.userId,
        score: r.score,
        sessionIds: r.sessionIds,
      })),
      sessions,
      stats,
      minPairs: MIN_PAIRS_FOR_CONVERGENCE,
      minSessions: MIN_SESSIONS_FOR_SCORE_Z,
    });
    const tenantId = query.tenantId ?? null;
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minPairs: MIN_PAIRS_FOR_CONVERGENCE,
      minSessionsForScoreZ: MIN_SESSIONS_FOR_SCORE_Z,
      ...result,
      caveat: CAVEAT,
      scoping: {
        tenantId,
        unscopedSections: tenantId ? ['sessionScoreReference'] : [],
      },
      provenance: {
        derivation:
          `Single-scenario scored cuts only (every session in the cut ran one scenario). Per cut: R1 = the ` +
          `foundational helping-skills composite (${FHS_JUDGE_MODEL}, 1–4); R2 = mean session score z-scored ` +
          `within its scenario version; R3 = (should-do − should-not-do) ÷ all behaviour-instruction hits; ` +
          `R4 = mean skill-coverage %; R6 = mean learner rating. Spearman rank correlation (average ranks ` +
          `for ties) for every pair over the cuts with both values.`,
        note:
          `All time. Cells with fewer than ${MIN_PAIRS_FOR_CONVERGENCE} cuts show n only. Cuts, not people: ` +
          `one learner contributes several cuts, so n overstates the independent evidence. Session signals ` +
          `cover whole sessions while a cut may start or end mid-session. ${CAVEAT} Rubric ` +
          `${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }
}
