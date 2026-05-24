import { Injectable } from '@nestjs/common';
import { ScenarioTranslationProgressPayload } from '../type/scenario-translation-progress.type';

@Injectable()
export class ScenarioTranslationNotificationService {
  private listener?: (
    userId: number,
    payload: ScenarioTranslationProgressPayload,
  ) => void;

  addListener(
    listener: (
      userId: number,
      payload: ScenarioTranslationProgressPayload,
    ) => void,
  ): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  notifyProgress(
    userId: number,
    payload: ScenarioTranslationProgressPayload,
  ): void {
    this.listener?.(userId, payload);
  }
}
