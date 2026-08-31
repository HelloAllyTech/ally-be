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
  IosTestflightHistoryResponseDto,
  IosTestflightStatusResponseDto,
  MobileCurrentVersionResponseDto,
  MobileDispatchResponseDto,
  MobileReleaseRunsResponseDto,
  MobileTriggerResponseDto,
  PromoteAndroidRequestDto,
  SubmitIosAppStoreReviewRequestDto,
} from './dto/mobile-releases.dto';

/**
 * GitHub Actions release/build status for ally-mobile's automated release
 * pipeline, plus a read-only App Store Connect TestFlight status view. Gated
 * ONLY to SUPER_DUPER_ADMIN — view:mobile-releases (migration 1941000000000)
 * for the read endpoints (GitHub-backed and the App Store Connect-backed
 * ios-testflight-status below), trigger:mobile-releases (migration
 * 1943000000000) for the manual scheduled-release dispatch endpoint,
 * promote:mobile-releases (migration 1944000000000) for the manual Android
 * production-promotion endpoint, and submit-app-store-review:mobile-releases
 * (migration 1944300000000) for the manual, full App Store review submission
 * endpoint below — same divergence pattern as the AWS Logs viewer. (iOS
 * external-TestFlight promotion used to have a matching manual endpoint here
 * too; removed once submission became fully automatic in ally-mobile's
 * build-ios-production.yml and this repo's actual testers turned out to all
 * be Internal, not External — see git history if it's ever needed again.)
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
      'Live App Store Connect TestFlight review status for the current iOS build',
  })
  @ApiResponse({ status: 200, type: IosTestflightStatusResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.VIEW_MOBILE_RELEASES],
  })
  @Get('ios-testflight-status')
  getIosTestflightStatus(): Promise<IosTestflightStatusResponseDto> {
    return this.mobileReleasesService.getIosTestflightStatus();
  }

  @ApiOperation({
    summary:
      'App Store Connect Beta App Review submission history across the last several iOS builds',
  })
  @ApiResponse({ status: 200, type: IosTestflightHistoryResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.VIEW_MOBILE_RELEASES],
  })
  @Get('ios-testflight-history')
  getIosTestflightHistory(): Promise<IosTestflightHistoryResponseDto> {
    return this.mobileReleasesService.getIosTestflightHistory();
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
      "MANUAL, REAL-PRODUCTION ACTION: dispatch submit-ios-app-store-review.yml to submit the current iOS build for Apple's FULL App Store review (real public distribution, not TestFlight). Does NOT auto-release to users — the workflow forces releaseType: MANUAL, so a human still has to explicitly release the build in App Store Connect after Apple approves it. Does not prepare the App Store Connect listing itself; that content work is assumed already done.",
  })
  @ApiResponse({ status: 200, type: MobileDispatchResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.MOBILE_RELEASES, {
    permissions: [PERMISSIONS.SUBMIT_APP_STORE_REVIEW],
  })
  @HttpCode(200)
  @Post('submit-ios-app-store-review')
  submitIosAppStoreReview(
    @Body() body: SubmitIosAppStoreReviewRequestDto,
  ): Promise<MobileDispatchResponseDto> {
    return this.mobileReleasesService.submitIosAppStoreReview(body.whatsNew);
  }
}
