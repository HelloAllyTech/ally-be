import { UserChatSessionData } from '../../chat/type/chat.type';
import { DeepgramTranscriptionOptions } from '../type/transcription.type';

export interface ITranscriptionService {
  handleAudioChatMuted(session: UserChatSessionData): Promise<void>;

  startLiveTranscription(
    {
      session,
      chatId,
      chatCreatedAt,
      options,
    }: {
      session: UserChatSessionData;
      chatId: number;
      chatCreatedAt?: Date;
      options?: DeepgramTranscriptionOptions;
    },
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
  ): Promise<void>;

  stopLiveTranscription(session: UserChatSessionData): Promise<void>;

  sendAudio(session: UserChatSessionData, audio: Buffer): Promise<void>;
}
