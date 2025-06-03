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

export type Chat = {
  role: string;
  content: string;
};

export type IdentifySpeakersRequest = {
  chat_history: Chat[];
};

export type TagPositivityRatingsRequest = {
  tags: string[];
};
