export interface TranscribeAndSummarizeRequestMessage {
  message_type: string;
  timestamp: number;
  chat_id: number;
  audio_url: string;
  sample_rate?: number;
}
