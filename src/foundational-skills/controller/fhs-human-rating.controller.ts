import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

import {
  FhsHumanRatingResponseDto,
  FhsHumanRatingSampleQueryDto,
  FhsHumanRatingSampleResponseDto,
  SubmitFhsHumanRatingDto,
} from '../dto/fhs-human-rating.dto';
import { FhsHumanRatingService } from '../service/fhs-human-rating.service';

/**
 * The human rating programme's API: the check on the foundational-skills
 * judge (EFF-81). Internal raters only, behind the same ANALYTICS toggle as the
 * super-admin analytics writes (e.g. `POST /v1/analytics/language-quality/reference`).
 * The agreement it feeds is `GET /v1/analytics/foundational-skills/judge-agreement`.
 */
@ApiTags('Foundational skills')
@Controller('v1/foundational-skills/human-ratings')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class FhsHumanRatingController {
  constructor(private readonly humanRatingService: FhsHumanRatingService) {}

  @Get('sample')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: "A quarter's human-rating sample (super-admin)",
    description:
      'Up to 30 foundational-skills cuts per calendar quarter (of `closedSessionEndedAt`), ' +
      'scored by the judge under the current rubric version, non-test orgs; stratified ' +
      "by composite tercile (over the quarter's own cuts) × majority session language, " +
      'allocated proportionally with at least one per non-empty stratum, and drawn in a ' +
      'seeded-hash order, so the same quarter always returns the same cuts while its ' +
      'population is unchanged. Each item carries the session and message ids that bound ' +
      'the window, how many people have rated it and whether the caller has. No transcript ' +
      'text. `quarter` defaults to the last complete quarter.',
  })
  @ApiResponse({ status: 200, type: FhsHumanRatingSampleResponseDto })
  async getSample(
    @Req() req: { user: { id: number } },
    @Query() query: FhsHumanRatingSampleQueryDto,
  ): Promise<FhsHumanRatingSampleResponseDto> {
    return this.humanRatingService.getSample(req.user.id, query.quarter);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Submit (or replace) a human rating of one cut (super-admin)',
    description:
      'The caller is the rater. Body: `cutId`, `ticks` (every rubric skill once: ' +
      '`opportunity`, observed behaviour codes, not-applicable conditional basics) and an ' +
      'optional `anyUnhelpful` cross-check. Levels are derived server-side with the ' +
      "judge's own rule; a submitted level is not accepted. Upsert: submitting again for " +
      "the same cut replaces the caller's earlier rating under the same rubric version " +
      '(`created: false`). 400 on any code that does not fit the rubric (all problems ' +
      'listed) or a cut the judge has not scored under the current version; 403 on the ' +
      "caller's own practice; 404 on an unknown cut.",
  })
  @ApiResponse({ status: 201, type: FhsHumanRatingResponseDto })
  async submit(
    @Req() req: { user: { id: number } },
    @Body() body: SubmitFhsHumanRatingDto,
  ): Promise<FhsHumanRatingResponseDto> {
    return this.humanRatingService.submit(req.user.id, body);
  }
}
