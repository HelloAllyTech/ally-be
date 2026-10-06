import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { FHS_RUBRIC_VERSION } from '../constants/helping-skills-rubric.constants';
import { HUMAN_RATING_SAMPLE_PER_QUARTER } from '../constants/fhs-human-rating.constants';
import {
  FhsHumanRatingResponseDto,
  FhsHumanRatingSampleResponseDto,
  SubmitFhsHumanRatingDto,
} from '../dto/fhs-human-rating.dto';
import { FhsHumanRatingRepository } from '../repository/fhs-human-rating.repository';
import {
  lastCompleteQuarterKey,
  parseQuarter,
  selectQuarterSample,
  validateHumanTicks,
} from '../util/human-rating.util';

const SAMPLE_NOTE =
  `Up to ${HUMAN_RATING_SAMPLE_PER_QUARTER} cuts per calendar quarter, scored by the judge under the current ` +
  'rubric version, non-test orgs; stratified by composite tercile (over the ' +
  "quarter's own cuts) × majority session language, allocated proportionally " +
  'with at least one per non-empty stratum, and drawn in a seeded hash order. ' +
  'The same quarter returns the same sample while its cuts are unchanged; a ' +
  'late-scored cut or a test-org flag can move it. Rate the window from the ' +
  'start message to the end message only, without looking at the judge’s scores.';

/**
 * The raters' side of the judge-vs-human check: which cuts to rate this
 * quarter, and storing what a rater saw.
 */
@Injectable()
export class FhsHumanRatingService {
  constructor(private readonly repository: FhsHumanRatingRepository) {}

  async getSample(
    raterId: number,
    quarterKey?: string,
    now: Date = new Date(),
  ): Promise<FhsHumanRatingSampleResponseDto> {
    const key = quarterKey ?? lastCompleteQuarterKey(now);
    const quarter = parseQuarter(key);
    if (!quarter) {
      throw new BadRequestException('quarter must look like 2026Q3');
    }
    const candidates = await this.repository.getQuarterCandidates(
      FHS_RUBRIC_VERSION,
      quarter,
    );
    const sample = selectQuarterSample(
      candidates,
      quarter.key,
      HUMAN_RATING_SAMPLE_PER_QUARTER,
    );
    const counts = await this.repository.getRatingCounts(
      FHS_RUBRIC_VERSION,
      sample.items.map((i) => i.candidate.cutId),
      raterId,
    );
    return {
      quarter: quarter.key,
      quarterStart: quarter.startDate,
      quarterEnd: quarter.endDate,
      quarterComplete: now.toISOString().slice(0, 10) >= quarter.endDate,
      rubricVersion: FHS_RUBRIC_VERSION,
      target: sample.target,
      population: sample.population,
      strata: sample.strata,
      items: sample.items.map(({ candidate: c, tercile }) => {
        const count = counts.get(c.cutId);
        return {
          cutId: c.cutId,
          closedAt: c.closedAt.toISOString(),
          sessionIds: c.sessionIds,
          startSessionId: c.startSessionId,
          startMessageId: c.startMessageId,
          endSessionId: c.endSessionId,
          endMessageId: c.endMessageId,
          startsMidSession: c.startsMidSession,
          endsMidSession: c.endsMidSession,
          language: c.language,
          tercile,
          raters: count?.raters ?? 0,
          ratedByMe: count?.ratedByMe ?? false,
          ownPractice: c.userId === raterId,
        };
      }),
      note: SAMPLE_NOTE,
      computedAt: now.toISOString(),
    };
  }

  /**
   * Store one rater's ticks for one cut, replacing their earlier rating of it
   * under the same rubric version (upsert, never a 409: correcting a slip is
   * the common case, and the latest submission is the rater's opinion).
   *
   * Refused: an unknown cut (404); a cut the judge has not scored under the
   * current version (400 — there is nothing to compare against); the rater's
   * own practice (403 — whoever is assessed is not the assessor); and any tick
   * that does not fit the rubric (400, every problem listed).
   */
  async submit(
    raterId: number,
    body: SubmitFhsHumanRatingDto,
  ): Promise<FhsHumanRatingResponseDto> {
    const cut = await this.repository.getCutForRating(
      body.cutId,
      FHS_RUBRIC_VERSION,
    );
    if (!cut) throw new NotFoundException('Cut not found');
    if (!cut.judgeScored) {
      throw new BadRequestException(
        `This cut has no judge score under ${FHS_RUBRIC_VERSION} yet, so there is nothing to compare a rating with`,
      );
    }
    if (cut.userId === raterId) {
      throw new ForbiddenException(
        'This cut is your own practice; rate a cut by someone else',
      );
    }

    const result = validateHumanTicks(body.ticks, body.anyUnhelpful);
    if (!result.ok) throw new BadRequestException(result.errors);

    const saved = await this.repository.upsertRating({
      cutId: cut.cutId,
      raterId,
      rubricVersion: FHS_RUBRIC_VERSION,
      ticks: result.rating.verdicts,
      anyUnhelpful: result.rating.anyUnhelpful,
    });
    return {
      id: saved.id,
      cutId: cut.cutId,
      rubricVersion: FHS_RUBRIC_VERSION,
      ticks: result.rating.verdicts,
      anyUnhelpful: result.rating.anyUnhelpful,
      ratedAt: saved.ratedAt.toISOString(),
      created: saved.created,
    };
  }
}
