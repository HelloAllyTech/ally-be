import { Injectable } from '@nestjs/common';

/**
 * Decouples the improvement orchestrator (emitter) from the socket.io
 * gateway (listener) — clone of RehearsalNotificationService.
 */
@Injectable()
export class ImprovementNotificationService {
  private listener?: (userId: number, improvementRunId: string) => void;

  addListener(
    listener: (userId: number, improvementRunId: string) => void,
  ): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  notifyUpdate(userId: number, improvementRunId: string): void {
    this.listener?.(userId, improvementRunId);
  }
}
