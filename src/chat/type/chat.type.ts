import { AudioChatProvider } from '../../common/constants/chat.constants';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { Feedback } from '../entity/feedback.entity';
import { Message, MessageType } from '../entity/message.entity';
import { ChatEvents } from '../constants/chat.constants';
import { CipherGCM } from 'crypto';
import { WriteStream } from 'fs';
import { ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';

export type UserChatSessionData = {
  id: string;
  type: 'user';
  userId: number;
  user: any;
  role: string;
  room: string;
  chatId: number;
  tenantId: string;
  provider?: AudioChatProvider;
};

export type ServiceSessionData = {
  id: number;
  type: 'service';
  serviceId: number;
  service: any;
  room: string;
};

export type MessagePayload = {
  type: ChatEvents;
  payload: any;
};

export type MessageWithFeedback = Message & {
  feedback?: Feedback;
};

export interface FormattedChatMessage {
  id: string | number;
  chatId: string | number;
  senderId: number | undefined;
  messageType: MessageType;
  content: string;
  context?: string | null;
  createdAt: string;
  feedback?: Feedback;
}

export type SendMessageWebSocketData = {
  chatId: number;
  content: string;
  context?: string;
  messageType?: MessageType;
  parentMessageId?: number;
};

export type NudgeResponse = {
  nudge: string;
  stage: string;
};

export type NudgeRequest = {
  latest_message: string;
  chat_history: MessageRequest[];
  force_nudge?: boolean;
};

export type ClientMessage = Message & {
  isFinal: boolean;
  isSentenceComplete: boolean;
  currentTranscriptBuffer: string;
};

export type SubscriptionData = {
  participants: number[];
  message: ClientMessage;
};

export type ActiveCallStream = {
  parts: Array<{
    ETag: string;
    PartNumber: number;
  }>;
  uploadId: string;
  key: string;
  partNumber: number;
  currentFileIndex: number;
  files: {
    cipher: CipherGCM;
    writeStream: WriteStream;
    encryptionKey: Buffer;
    iv: Buffer;
    tempFilePath: string;
    bufferSize: number;
  }[];
  callId: string;
  chatId: number;
};

export interface UpdateChatInput {
  summaryStatus?: ChatSummaryStatus;
  metadata?: Record<string, any>;
  status?: ChatStatus;
}
