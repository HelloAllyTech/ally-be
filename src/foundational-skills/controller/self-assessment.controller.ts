import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  SelfAssessmentDueResponseDto,
  SubmitSelfAssessmentDto,
  SubmitSelfAssessmentResponseDto,
} from '../dto/self-assessment.dto';
import { SelfAssessmentService } from '../service/self-assessment.service';

/**
 * The learner self-efficacy instrument, learner side. Every route acts on the
 * caller's own JWT user and org only.
 *
 * Gated on `EDIT_SCENARIO_SESSION_FEEDBACK` — the permission a learner already
 * holds to rate their own practice sessions, which is the nearest existing
 * self-report. Both routes share it so a learner who is told an answer is due
 * can always submit it. No feature toggle, like the other learner routes.
 */
@ApiTags('Self assessment')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/self-assessment')
export class SelfAssessmentController {
  constructor(private readonly selfAssessmentService: SelfAssessmentService) {}

  @ApiOperation({
    summary: 'Is a self-efficacy self-assessment due for me now?',
    description:
      'Due at onboarding (never answered), after every 3 more scored practice slices, and when a ' +
      'course is completed — at most once per 24 hours. Always returns the current instrument ' +
      '(14 helping-skill items, 0–10); show it only when `due` is true and send `trigger` back.',
  })
  @ApiResponse({ status: 200, type: SelfAssessmentDueResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION_FEEDBACK])
  @Get('due')
  async getDue(
    @CurrentUser() user: TokenUser,
  ): Promise<SelfAssessmentDueResponseDto> {
    return this.selfAssessmentService.getDue(user.id);
  }

  @ApiOperation({
    summary: 'Submit my self-efficacy self-assessment',
    description:
      '`responses` holds integers 0–10 for the answered items only (skipped items omitted); `{}` ' +
      'records a dismissal. 400: unknown or retired `instrumentVersion`, or a malformed answer. ' +
      '409: no answer is due, or the due `trigger` changed — re-read GET due.',
  })
  @ApiResponse({ status: 201, type: SubmitSelfAssessmentResponseDto })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION_FEEDBACK])
  @HttpCode(201)
  @Post()
  async submit(
    @CurrentUser() user: TokenUser,
    @Body() dto: SubmitSelfAssessmentDto,
  ): Promise<SubmitSelfAssessmentResponseDto> {
    return this.selfAssessmentService.submit(
      { id: user.id, tenantId: user.tenantId },
      dto,
    );
  }
}
