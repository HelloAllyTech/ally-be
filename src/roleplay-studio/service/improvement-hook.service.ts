import { Injectable } from '@nestjs/common';
import { RehearsalRun } from '../entity/rehearsal-run.entity';

/**
 * Decouples RehearsalService (which sees rehearsal end statuses land) from
 * the ImprovementOrchestratorService (which advances the auto-improve loop) —
 * the same listener-registration pattern as RehearsalNotificationService, so
 * neither service imports the other.
 */
@Injectable()
export class ImprovementHookService {
  private listener?: (run: RehearsalRun) => void;

  addListener(listener: (run: RehearsalRun) => void): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  /** Fired whenever a rehearsal reaches an end status (webhook/timer/cancel). */
  notifyRehearsalFinished(run: RehearsalRun): void {
    this.listener?.(run);
  }
}
