export type GenerateSummaryRequest = {
  chat_history: MessageRequest[];
};

export type MessageRequest = {
  role: string;
  content: string;
  timestamp?: string;
};

export type EnhanceTextRequest = {
  content: string;
};
