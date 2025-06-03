import { Inject, Injectable } from '@nestjs/common';
import { ITranscriptionService } from '../interfaces/transcription.interface';
import {
  DeepgramTranscriptionOptions,
  TranscriptionSessionData,
} from '../type/transcription.type';

@Injectable()
export class TranscriptionService {
  constructor(
    @Inject('transcriptionService')
    private readonly transcriptionService: ITranscriptionService,
  ) {}

  async startLiveTranscription<T extends TranscriptionSessionData>(
    session: T,
    chatId: number,
    callback: (session: T, chatId: number, transcript: string) => void,
    options?: DeepgramTranscriptionOptions,
  ) {
    await this.transcriptionService.startLiveTranscription<T>(
      session,
      chatId,
      callback,
      options,
    );
  }

  async stopLiveTranscription<T extends TranscriptionSessionData>(session: T) {
    await this.transcriptionService.stopLiveTranscription<T>(session);
  }

  async sendAudio<T extends TranscriptionSessionData>(
    session: T,
    audio: Buffer,
  ) {
    await this.transcriptionService.sendAudio<T>(session, audio);
  }

  async handleAudioChatMuted<T extends TranscriptionSessionData>(session: T) {
    await this.transcriptionService.handleAudioChatMuted<T>(session);
  }
}
