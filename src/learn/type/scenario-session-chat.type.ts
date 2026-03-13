export interface CitationResponse {
  timestamp: string | null;
  content: string;
  senderId: number;
  transcriptId: number;
}

export enum StreamEventType {
  START = 'start',
  TOKEN = 'token',
  CITATIONS = 'citations',
  DONE = 'done',
  ERROR = 'error',
}

export interface SessionChatHistoryResponse {
  citations: CitationHistoryResponse[];
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CitationHistoryResponse {
  timestamp: string | null;
  content: string;
  senderId: number;
  transcriptId: number;
}
