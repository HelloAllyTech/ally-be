import { ScenarioReportStatus } from '../enum/scenario-report.enum';

export const SCENARIO_REPORT_END_STATUSES: ScenarioReportStatus[] = [
  ScenarioReportStatus.COMPLETED,
  ScenarioReportStatus.CANCELLED,
  ScenarioReportStatus.FAILED,
];
