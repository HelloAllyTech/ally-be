import { Inject, Injectable } from '@nestjs/common';
import { ITranscriptionService } from '../interfaces/transcription.interface';
import { DeepgramTranscriptionOptions } from '../type/transcription.type';
import { UserChatSessionData } from '../../chat/type/chat.type';

@Injectable()
export class TranscriptionService {
  constructor(
    @Inject('transcriptionService')
    private readonly transcriptionService: ITranscriptionService,
  ) {}

  async startLiveTranscription(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
    options?: DeepgramTranscriptionOptions,
  ) {
    await this.transcriptionService.startLiveTranscription(
      session,
      chatId,
      callback,
      options,
    );
  }

  async stopLiveTranscription(session: UserChatSessionData) {
    await this.transcriptionService.stopLiveTranscription(session);
  }

  async sendAudio(session: UserChatSessionData, audio: Buffer) {
    await this.transcriptionService.sendAudio(session, audio);
  }

  async handleAudioChatMuted(session: UserChatSessionData) {
    await this.transcriptionService.handleAudioChatMuted(session);
  }
}
