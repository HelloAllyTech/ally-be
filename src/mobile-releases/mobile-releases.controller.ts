import { Controller, Get } from '@nestjs/common';
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
} from './dto/mobile-releases.dto';

/**
 * GitHub Actions release/build status for ally-mobile's automated release
 * pipeline. Gated ONLY to SUPER_DUPER_ADMIN (view:mobile-releases, migration
 * 1941000000000) — same divergence pattern as the AWS Logs viewer.
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
}
