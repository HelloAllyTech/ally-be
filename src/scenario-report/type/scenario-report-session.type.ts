import { ScenarioReportRoomTypes } from '../enum/scenario-report.enum';

export type ScenarioReportSessionData = {
  userId: number;
  roomType: ScenarioReportRoomTypes;
  clientId: string;
  lookbackMinutes?: number;
  reportId?: string;
};
