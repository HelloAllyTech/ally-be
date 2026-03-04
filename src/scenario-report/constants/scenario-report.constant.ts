import { ScenarioReportStatus } from '../enum/scenario-report.enum';

export const SCENARIO_REPORT_END_STATUSES: ScenarioReportStatus[] = [
  ScenarioReportStatus.COMPLETED,
  ScenarioReportStatus.CANCELLED,
  ScenarioReportStatus.FAILED,
];

export const SCENARIO_REPORT_PENDING_STATUSES: ScenarioReportStatus[] = [
  ScenarioReportStatus.STARTED,
  ScenarioReportStatus.IN_PROGRESS,
];

export const SCENARIO_REPORT_TIMEOUT_MINUTES = 30;
export const SCENARIO_REPORT_TTL_SECONDS = SCENARIO_REPORT_TIMEOUT_MINUTES * 60;
export const SCENARIO_REPORT_REDIS_KEY_PREFIX = 'scenario-report';
export const EXPIRED_CHANNEL = '__keyevent@0__:expired';
