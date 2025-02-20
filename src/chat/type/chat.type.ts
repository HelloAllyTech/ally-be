import { Feedback } from '../../common/entities/feedback.entity';
import { Message, MessageType } from '../../common/entities/message.entity';
import { ChatEvents } from '../constants/chat.constants';

export type UserChatSessionData = {
  type: 'user';
  userId: number;
  user: any;
  role: string;
  room: string;
  chatId: number;
};

export type ServiceSessionData = {
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
  message_id: string | number;
  chat_id: string | number;
  sender_id: number | undefined;
  message_type: MessageType;
  content: string;
  context?: string | null;
  created_at: string;
  feedback?: Feedback;
}

export type SendMessageWebSocketData = {
  chat_id: number;
  content: string;
  context?: string;
};
