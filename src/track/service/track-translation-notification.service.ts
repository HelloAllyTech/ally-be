import { Injectable } from '@nestjs/common';
import { TrackTranslationProgressPayload } from '../type/track-translation.type';

/**
 * Decouples the translation job from the WebSocket gateway, mirroring
 * `ScenarioTranslationNotificationService`: the job emits progress without
 * importing the gateway, and the gateway registers itself as the listener at
 * init. Keeps TrackModule free of a socket dependency.
 */
@Injectable()
export class TrackTranslationNotificationService {
  private listener?: (
    userId: number,
    payload: TrackTranslationProgressPayload,
  ) => void;

  addListener(
    listener: (
      userId: number,
      payload: TrackTranslationProgressPayload,
    ) => void,
  ): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = undefined;
  }

  notifyProgress(
    userId: number,
    payload: TrackTranslationProgressPayload,
  ): void {
    this.listener?.(userId, payload);
  }
}
