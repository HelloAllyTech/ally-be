import { Injectable } from '@nestjs/common';

import {
  FEEDBACK_SKILL_MAPPER_MODEL,
  FEEDBACK_SKILL_MAPPER_VERSION,
} from 'src/foundational-skills/constants/feedback-skill-mapper.constants';
import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FeedbackUptakeQueryDto,
  FeedbackUptakeResponseDto,
} from '../dto/feedback-uptake-analytics.dto';
import {
  FeedbackUptakeAnalyticsRepository,
  FeedbackUptakeCoverageRow,
  FeedbackUptakeSessionRow,
} from '../repository/feedback-uptake-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  UptakeCut,
  UptakeSession,
  buildFeedbackUptake,
} from '../util/feedback-uptake.util';

export const FEEDBACK_UPTAKE_CAVEAT =
  'Observational, not causal: a skill rising after a debrief named it is associated with ' +
  'the feedback, not shown to be caused by it. The named skill is usually the one that ' +
  'was weak, so regression to the mean inflates its "rose" share on its own — the ' +
  'unnamed skills of the same learners are the control for that, and the arms’ ' +
  'before levels show how far apart they started. A skill counts only where both cuts ' +
  'gave an opportunity to show it.';

/**
 * The whole response from already-read rows, without a database — so the
 * mapping of rows to sessions, the pairing and the floors are tested on
 * fixtures alone.
 */
export function buildFeedbackUptakeResponse(input: {
  sessions: readonly FeedbackUptakeSessionRow[];
  cuts: readonly UptakeCut[];
  coverage: FeedbackUptakeCoverageRow;
  tenantId: string | null;
  floor: number;
  now?: Date;
}): FeedbackUptakeResponseDto {
  const cutsByUser = new Map<number, UptakeCut[]>();
  for (const cut of input.cuts) {
    const list = cutsByUser.get(cut.userId) ?? [];
    list.push(cut);
    cutsByUser.set(cut.userId, list);
  }
  for (const list of cutsByUser.values()) {
    list.sort(
      (a, b) =>
        a.closedAt.getTime() - b.closedAt.getTime() || a.cutIndex - b.cutIndex,
    );
  }

  let improvements = 0;
  let improvementsWithoutSkill = 0;
  const sessions: UptakeSession[] = input.sessions.map((row) => {
    improvements += row.items.length;
    const named = new Set<string>();
    for (const item of row.items) {
      if (typeof item?.skill === 'string' && item.skill) named.add(item.skill);
      else improvementsWithoutSkill += 1;
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      endedAt: row.endedAt,
      namedSkills: [...named],
    };
  });

  const built = buildFeedbackUptake(sessions, cutsByUser, input.floor);

  return {
    rubricVersion: FHS_RUBRIC_VERSION,
    mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
    minSampleSize: input.floor,
    coverage: {
      debriefedSessions: input.coverage.debriefed,
      mappedSessions: input.coverage.mapped,
      skippedSessions: input.coverage.skipped,
      failedSessions: input.coverage.failed,
      pendingSessions: input.coverage.pending,
      improvements,
      improvementsWithoutSkill,
      sessionsPaired: built.sessionsPaired,
      windows: built.windows,
      learnersPaired: built.learnersPaired,
      namedNotAssessable: built.namedNotAssessable,
    },
    pooled: built.pooled,
    skills: built.skills,
    caveat: FEEDBACK_UPTAKE_CAVEAT,
    provenance: {
      derivation:
        `R1 (foundational helping skills, rubric ${FHS_RUBRIC_VERSION}): each learner's last ` +
        'scored cut closed by the end of a debriefed session against their first cut made ' +
        "wholly after it, per skill assessable in both. A skill is NAMED when the window's " +
        'debriefs filed an improvement under it (AI task feedback-improvement-skill-mapping, ' +
        `mapper ${FEEDBACK_SKILL_MAPPER_VERSION}, ${FEEDBACK_SKILL_MAPPER_MODEL} pinned), ` +
        'UNNAMED otherwise. Per learner one share per skill per role; the difference is ' +
        'within learner, with a deterministic bootstrap over learners. All time; test ' +
        'organisations excluded.',
      note: FEEDBACK_UPTAKE_CAVEAT,
    },
    scoping: {
      tenantId: input.tenantId,
      note: input.tenantId
        ? "Sessions by their own org; cuts by the org they were practised in — a learner's " +
          'cuts from another org do not pair with this org’s debriefs.'
        : 'Every non-test org.',
    },
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * EFF-40 · Named improvements that were acted on (AAQ-221): when a debrief
 * tells a learner to work on a skill, does that skill change, compared with
 * the skills it did not name?
 */
@Injectable()
export class FeedbackUptakeAnalyticsService {
  constructor(private readonly repository: FeedbackUptakeAnalyticsRepository) {}

  async getFeedbackUptake(
    query: FeedbackUptakeQueryDto,
  ): Promise<FeedbackUptakeResponseDto> {
    const tenantId = query.tenantId || undefined;
    const [sessions, cuts, coverage] = await Promise.all([
      this.repository.getMappedSessions(
        FEEDBACK_SKILL_MAPPER_VERSION,
        tenantId,
      ),
      this.repository.getScoredCuts(
        FHS_RUBRIC_VERSION,
        FEEDBACK_SKILL_MAPPER_VERSION,
        tenantId,
      ),
      this.repository.getCoverage(
        FEEDBACK_SKILL_MAPPER_VERSION,
        FHS_RUBRIC_VERSION,
        tenantId,
      ),
    ]);
    return buildFeedbackUptakeResponse({
      sessions,
      cuts,
      coverage,
      tenantId: tenantId ?? null,
      floor: MIN_SCORE_SAMPLE_SIZE,
    });
  }
}
