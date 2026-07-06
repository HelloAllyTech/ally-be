import { Injectable } from '@nestjs/common';

/**
 * Decouples RehearsalService (emitter) from the socket.io gateway (listener),
 * mirroring ScenarioReportNotificationService.
 */
@Injectable()
export class RehearsalNotificationService {
  private listener?: (userId: number, rehearsalId: string) => void;

  addListener(listener: (userId: number, rehearsalId: string) => void): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  notifyUpdate(userId: number, rehearsalId: string): void {
    this.listener?.(userId, rehearsalId);
  }
}
