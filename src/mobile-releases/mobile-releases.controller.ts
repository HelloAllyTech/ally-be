import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { MobileReleasesService } from './mobile-releases.service';
import {
  MobileCurrentVersionResponseDto,
  MobileDispatchResponseDto,
  MobileReleaseRunsResponseDto,
  MobileTriggerResponseDto,
  PromoteAndroidRequestDto,
} from './dto/mobile-releases.dto';

/**
 * GitHub Actions release/build status for ally-mobile's automated release
 * pipeline. Gated ONLY to SUPER_DUPER_ADMIN — view:mobile-releases (migration
 * 1941000000000) for the read endpoints, trigger:mobile-releases (migration
 * 1943000000000) for the manual scheduled-release dispatch endpoint, and
 * promote:mobile-releases (migration 1944000000000) for the manual promote
 * endpoints below — same divergence pattern as the AWS Logs viewer.
 */
@Controller('v1/mobile-releases')
@ApiTags('Mobile Releases')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class MobileReleasesController {
  constructor(private readonly mobileReleasesService: MobileReleasesService) {}

  @ApiOperation({
    summary: 'Recent GitHub Actions runs for the ally-mobile release pipeline',
  })
  @ApiResponse({ status: 200, type: MobileReleaseRunsResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.VIEW_MOBILE_RELEASES],
  })
  @Get('runs')
  async getRuns(): Promise<MobileReleaseRunsResponseDto> {
    const runs = await this.mobileReleasesService.listRuns();
    return { runs };
  }

  @ApiOperation({ summary: 'Current app version on ally-mobile master' })
  @ApiResponse({ status: 200, type: MobileCurrentVersionResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.VIEW_MOBILE_RELEASES],
  })
  @Get('current-version')
  getCurrentVersion(): Promise<MobileCurrentVersionResponseDto> {
    return this.mobileReleasesService.getCurrentVersion();
  }

  @ApiOperation({
    summary:
      'Manually dispatch scheduled-mobile-release.yml (force: skips the 48h cadence gate, tests still gate the actual build)',
  })
  @ApiResponse({ status: 200, type: MobileTriggerResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.TRIGGER_MOBILE_RELEASES],
  })
  @HttpCode(200)
  @Post('trigger')
  triggerRelease(): Promise<MobileTriggerResponseDto> {
    return this.mobileReleasesService.triggerRelease();
  }

  @ApiOperation({
    summary:
      'MANUAL, REAL-PRODUCTION ACTION: dispatch promote-android-production.yml to advance the Play Store production track staged rollout to rolloutPercentage%. Requires the Play Console service account to have "Release to production" permission, not just internal-track release.',
  })
  @ApiResponse({ status: 200, type: MobileDispatchResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.PROMOTE_MOBILE_RELEASES],
  })
  @HttpCode(200)
  @Post('promote-android')
  promoteAndroid(
    @Body() body: PromoteAndroidRequestDto,
  ): Promise<MobileDispatchResponseDto> {
    return this.mobileReleasesService.promoteAndroid(body.rolloutPercentage);
  }

  @ApiOperation({
    summary:
      'MANUAL, REAL-PRODUCTION ACTION: dispatch promote-ios-testflight-external.yml to promote the current TestFlight internal build to the external testing group. Requires the TESTFLIGHT_EXTERNAL_GROUP_NAME repo variable to be set on ally-mobile.',
  })
  @ApiResponse({ status: 200, type: MobileDispatchResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.PROMOTE_MOBILE_RELEASES],
  })
  @HttpCode(200)
  @Post('promote-ios-testflight')
  promoteIosTestflight(): Promise<MobileDispatchResponseDto> {
    return this.mobileReleasesService.promoteIosTestflight();
  }
}
