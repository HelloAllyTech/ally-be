export type GenerateSummaryRequest = {
  messages: { role: string; content: string }[];
};

export type MessageRequest = {
  role: string;
  content: string;
  timestamp?: string;
};
