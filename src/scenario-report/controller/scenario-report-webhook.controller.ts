import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ScenarioReportDto,
  UpdateScenarioReportDto,
} from '../dto/scenario-report.dto';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { ScenarioReportService } from '../service/scenario-report.service';

@Controller({ path: 'learn/scenarios/reports/webhook', version: '1' })
@ApiTags('Scenario Report Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class ScenarioReportWebhookController {
  constructor(private readonly scenarioReportService: ScenarioReportService) {}

  @Patch(':reportId')
  @ApiOperation({
    summary: 'Webhook for updating a scenario report (API key only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Scenario report updated',
    type: ScenarioReportDto,
  })
  async updateScenarioReport(
    @Param('reportId') reportId: string,
    @Body() updateScenarioReportDto: UpdateScenarioReportDto,
  ): Promise<ScenarioReportDto> {
    return this.scenarioReportService.updateScenarioReport(
      reportId,
      updateScenarioReportDto,
    );
  }
}
