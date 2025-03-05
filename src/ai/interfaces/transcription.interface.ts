import { UserChatSessionData } from '../../chat/type/chat.type';
import { DeepgramTranscriptionOptions } from '../type/transcription.type';

export interface ITranscriptionService {
  startLiveTranscription(
    session: UserChatSessionData,
    chatId: number,
    callback: (
      session: UserChatSessionData,
      chatId: number,
      transcript: string,
    ) => void,
    options?: DeepgramTranscriptionOptions,
  ): Promise<void>;

  stopLiveTranscription(userId: number): Promise<void>;

  sendAudio(session: UserChatSessionData, audio: Buffer): Promise<void>;
}
