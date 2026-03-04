import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ScenarioReportService } from './scenario-report.service';
import { SCENARIO_REPORT_TIMEOUT_MINUTES } from '../constants/scenario-report.constant';

@Injectable()
export class ScenarioReportSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly scenarioReportService: ScenarioReportService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      `${SCENARIO_REPORT_TIMEOUT_MINUTES}min`,
      'scenario-report-timeout',
      () => this.scenarioReportService.markStaleReportsAsFailed(),
    );
  }
}
