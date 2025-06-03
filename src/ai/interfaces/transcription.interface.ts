import {
  DeepgramTranscriptionOptions,
  TranscriptionSessionData,
} from '../type/transcription.type';

export interface ITranscriptionService {
  handleAudioChatMuted<T extends TranscriptionSessionData>(
    session: T,
  ): Promise<void>;

  startLiveTranscription<T extends TranscriptionSessionData>(
    session: T,
    chatId: number,
    callback: (session: T, chatId: number, transcript: string) => void,
    options?: DeepgramTranscriptionOptions,
  ): Promise<void>;

  stopLiveTranscription<T extends TranscriptionSessionData>(
    session: T,
  ): Promise<void>;

  sendAudio<T extends TranscriptionSessionData>(
    session: T,
    audio: Buffer,
  ): Promise<void>;
}
