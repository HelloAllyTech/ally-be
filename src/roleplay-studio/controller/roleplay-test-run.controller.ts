import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoleplayTestRunService } from '../service/roleplay-test-run.service';
import {
  CreateTestRunDto,
  ListTestReportsQueryDto,
} from '../dto/roleplay-test-run.dto';

/**
 * Improve test runs — same audience as the studio's primary surface
 * (EDIT_ROLEPLAY_COPILOT), so whoever can build a spec can test it.
 */
@ApiTags('Roleplay Studio Test Runs')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio', version: '1' })
export class RoleplayTestRunController {
  constructor(private readonly testRunService: RoleplayTestRunService) {}

  @Post('specs/:specId/test-runs')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary:
      'Run the selected agent test cases against the current draft (one ' +
      'non-terminal run per spec) → { run, reports }',
  })
  createTestRun(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Body() dto: CreateTestRunDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.testRunService.createTestRun(specId, dto, user.id);
  }

  @Get('specs/:specId/test-reports')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary:
      "Poll-friendly newest-first list of a spec's test reports across runs " +
      '(no transcript/markdown payloads)',
  })
  listReports(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Query() query: ListTestReportsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.testRunService.listReports(specId, user.id, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('test-reports/:reportId')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary: 'Full test report (transcript, judge scores, markdown)',
  })
  getReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.testRunService.getReport(reportId, user.id);
  }

  @Post('test-runs/:runId/cancel')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({ summary: 'Cancel an in-flight test run' })
  cancelRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.testRunService.cancelRun(runId, user.id);
  }
}
