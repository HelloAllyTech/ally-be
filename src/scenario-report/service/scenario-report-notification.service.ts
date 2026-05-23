import { Injectable } from '@nestjs/common';

@Injectable()
export class ScenarioReportNotificationService {
  private listener?: (userId: number, reportId: string) => void;

  addListener(listener: (userId: number, reportId: string) => void): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  notifyUpdate(userId: number, reportId: string): void {
    this.listener?.(userId, reportId);
  }
}
