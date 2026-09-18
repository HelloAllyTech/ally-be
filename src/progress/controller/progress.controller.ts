import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ProgressService } from '../service/progress.service';
import { ProgressResponseDto, ProgressSummaryDto } from '../dto/progress.dto';

/**
 * Every route here is self-scoped: the learner id comes from the JWT and there is no
 * path or query parameter that could address another user. Reuses VIEW_USER_RANK, the
 * permission the streak and rank surfaces already carry, because this is the same class
 * of personal engagement data.
 */
@ApiTags('Progress')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'progress',
  version: '1',
})
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('me/enabled')
  @ApiOperation({
    summary:
      "Whether the caller's organisation has the Progress dashboard switched on",
  })
  @ApiResponse({ status: 200, type: Boolean })
  // Authenticated-only on purpose: the answer is one boolean about the caller's own
  // org, and the nav has to ask it before it knows whether to render the indicator.
  @AuthPermissions([])
  async isEnabled(@CurrentUser() user: TokenUser): Promise<boolean> {
    return this.progressService.isEnabledForTenant(user.tenantId);
  }

  @Get('me/summary')
  @AuthPermissions([PERMISSIONS.VIEW_USER_RANK])
  @ApiOperation({
    summary:
      'Level and XP state without the dashboard payload. Intended for the persistent nav indicator, which asks on every route.',
  })
  @ApiResponse({ status: 200, type: ProgressSummaryDto })
  async getSummary(
    @CurrentUser() user: TokenUser,
  ): Promise<ProgressSummaryDto> {
    return this.progressService.getSummary(user.id, user.tenantId);
  }

  @Get('me')
  @AuthPermissions([PERMISSIONS.VIEW_USER_RANK])
  @ApiOperation({
    summary:
      'Full progress dashboard payload: level state, lifetime totals and the level ladder',
  })
  @ApiResponse({ status: 200, type: ProgressResponseDto })
  async getProgress(
    @CurrentUser() user: TokenUser,
  ): Promise<ProgressResponseDto> {
    return this.progressService.getProgress(user.id, user.tenantId);
  }
}
