export interface TranscribeAndSummarizeResponseMessage {
  message_type: string;
  timestamp: number;
  chat_id: number;
  download_presigned_url?: string;
  delete_presigned_url?: string;
  error?: string;
}
