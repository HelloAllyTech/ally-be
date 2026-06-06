import { ScribeSessionMode } from 'src/common/constants/chat.constants';

export interface TranscribeAndSummarizeRequestMessage {
  message_type: string;
  timestamp: number;
  chat_id: number;
  audio_url: string;
  sample_rate?: number;
  mode?: ScribeSessionMode;
  is_linear16_encoded?: boolean;
}
