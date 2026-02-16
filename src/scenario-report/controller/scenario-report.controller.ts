import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ScenarioReportService } from '../service/scenario-report.service';
import { ScenarioReport } from '../entity/scenario-report.entity';
import {
  CreateScenarioReportDto,
  CreateScenarioReportResponseDto,
  ScenarioReportDto,
  ScenarioReportResponseDto,
} from '../dto/scenario-report.dto';
import { ScenarioReportTranscriptResponseDto } from '../dto/scenario-report-transcript.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { SuccessResponse } from 'src/common/type/common.type';

@ApiTags('Scenario Report')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/scenarios',
  version: '1',
})
export class ScenarioReportController {
  constructor(private readonly scenarioReportService: ScenarioReportService) {}

  @Post('/:scenarioId/reports')
  @ApiOperation({ summary: 'Create a report for a scenario' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_REPORTS])
  @ApiResponse({
    status: 201,
    description: 'Scenario report created',
    type: ScenarioReport,
  })
  async createScenarioReport(
    @CurrentUser() tokenUser: TokenUser,
    @Param('scenarioId') scenarioId: number,
    @Body() createScenarioReportDto: CreateScenarioReportDto,
  ): Promise<CreateScenarioReportResponseDto> {
    return this.scenarioReportService.createScenarioReport(
      scenarioId,
      createScenarioReportDto,
      tokenUser.id,
    );
  }

  @Get('/reports/:reportId')
  @ApiOperation({ summary: 'Get a scenario report by id' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_REPORTS])
  @ApiResponse({
    status: 200,
    description: 'Scenario report by id',
    type: ScenarioReportDto,
  })
  async getScenarioReportById(
    @Param('reportId') reportId: string,
  ): Promise<ScenarioReportDto> {
    return this.scenarioReportService.getScenarioReportById(reportId);
  }

  @Get('/reports/:reportId/transcripts')
  @ApiOperation({ summary: 'Get transcript for a scenario report' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_REPORTS])
  @ApiResponse({
    status: 200,
    description: 'Scenario report transcript by id',
    type: ScenarioReportTranscriptResponseDto,
  })
  async getScenarioReportTranscriptById(
    @Param('reportId') reportId: string,
  ): Promise<ScenarioReportTranscriptResponseDto> {
    return this.scenarioReportService.getScenarioReportTranscripts(reportId);
  }

  @Get('/:scenarioId/reports')
  @ApiOperation({ summary: 'Get all reports for a scenario' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_REPORTS])
  @ApiResponse({
    status: 200,
    description: 'Scenario reports',
    type: ScenarioReportResponseDto,
    isArray: true,
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: String,
    description:
      'Filter by scenario report status (comma-separated). Valid values: STARTED, IN_PROGRESS, COMPLETED, CANCELLED, FAILED',
  })
  async getScenarioReports(
    @Param('scenarioId') scenarioId: number,
    @Query('statuses') statuses?: string,
  ): Promise<ScenarioReportResponseDto> {
    return this.scenarioReportService.getScenarioReports(scenarioId, statuses);
  }

  @Get('/reports/:reportId/cancel')
  @ApiOperation({ summary: 'Cancel a scenario report' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_REPORTS])
  @ApiResponse({
    status: 200,
    description: 'Scenario report cancelled',
    type: Boolean,
  })
  async cancelScenarioReport(
    @Param('reportId') reportId: string,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.scenarioReportService.cancelScenarioReport(
      reportId,
      tokenUser.id,
    );
  }
}
