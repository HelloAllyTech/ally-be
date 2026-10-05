import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsTransferQueryDto,
  FoundationalSkillsTransferResponseDto,
} from '../dto/foundational-skills-transfer.dto';
import { FoundationalSkillsTransferRepository } from '../repository/foundational-skills-transfer.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  TRANSFER_MIN_SINGLE_SCENARIO_CUTS,
  buildTransfer,
} from '../util/foundational-skills-transfer.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

/**
 * Transfer to a new scenario (EFF-14, AAQ-220, Highlights → Helping skills).
 *
 * The pairing rules and floors live in `util/foundational-skills-transfer.util.ts`;
 * this service only reads, wires and labels. With no data the response is all
 * zero counts and null statistics, never a 404.
 */
@Injectable()
export class FoundationalSkillsTransferAnalyticsService {
  constructor(
    private readonly repository: FoundationalSkillsTransferRepository,
  ) {}

  async getTransfer(
    query: FoundationalSkillsTransferQueryDto = {},
  ): Promise<FoundationalSkillsTransferResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const rows = await withReportingQuerySlot(() =>
      this.repository.getCutScenarios(FHS_RUBRIC_VERSION, tenantId),
    );
    const built = buildTransfer(rows, {
      floor: MIN_SCORE_SAMPLE_SIZE,
      minSingleCuts: TRANSFER_MIN_SINGLE_SCENARIO_CUTS,
    });

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minSingleScenarioCuts: TRANSFER_MIN_SINGLE_SCENARIO_CUTS,
      scoreDomain: [1, 4],
      ...built,
      provenance: {
        derivation:
          `R1 — foundational helping skills cuts: each learner's roleplay speech in ` +
          `${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character slices, each scored by ` +
          `${FHS_JUDGE_MODEL} on the fixed 14-skill rubric (${FHS_RUBRIC_VERSION}); composite 1–4. ` +
          `Only cuts in which every session played one scenario are compared. For learners with ` +
          `${TRANSFER_MIN_SINGLE_SCENARIO_CUTS}+ such cuts: the first cut on a scenario they had met in no ` +
          `earlier cut, against the single-scenario cut just before it on a scenario they had met. One ` +
          `value per learner (pairs averaged), paired bootstrap 95% CI and a sign test, withheld below ` +
          `${MIN_SCORE_SAMPLE_SIZE} learners. All time; test organisations excluded.`,
        note:
          `New scenarios are often harder — read this with the difficulty mix by practice ordinal ` +
          `(AAQ-207) and with the same-difficulty comparison beside it. Familiar material also reads ` +
          `higher than first contact with new material even when the skill does carry over, so a drop ` +
          `here can be difficulty or novelty rather than lost skill. Observational: an association, not ` +
          `a cause. Covers only single-scenario cuts (see the share). AI-judged; not yet checked ` +
          `against trained human raters.`,
      },
      // Cuts carry the tenant of their own session, so nothing stays platform-wide.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
