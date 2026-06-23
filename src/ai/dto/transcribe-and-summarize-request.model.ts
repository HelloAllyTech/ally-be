import { ScribeSessionMode } from 'src/common/constants/chat.constants';

export interface TranscribeAndSummarizeRequestMessage {
  message_type: string;
  timestamp: number;
  chat_id: number;
  audio_url: string;
  sample_rate?: number;
  mode?: ScribeSessionMode;
  is_linear16_encoded?: boolean;
  // End-to-end trace id, minted at dispatch and echoed back on the result
  // callback so a single chat's transcription journey can be traced across
  // ally-be and ally-ai.
  correlation_id?: string;
}
