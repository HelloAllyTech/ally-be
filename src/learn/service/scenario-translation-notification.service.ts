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

  notifyProgress(
    userId: number,
    payload: ScenarioTranslationProgressPayload,
  ): void {
    this.listener?.(userId, payload);
  }
}
