import { Controller, Get, HttpCode, Post } from '@nestjs/common';
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
  MobileReleaseRunsResponseDto,
  MobileTriggerResponseDto,
} from './dto/mobile-releases.dto';

/**
 * GitHub Actions release/build status for ally-mobile's automated release
 * pipeline. Gated ONLY to SUPER_DUPER_ADMIN — view:mobile-releases (migration
 * 1941000000000) for the read endpoints, and the narrower
 * trigger:mobile-releases (migration 1943000000000) for the manual dispatch
 * endpoint — same divergence pattern as the AWS Logs viewer.
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
}
