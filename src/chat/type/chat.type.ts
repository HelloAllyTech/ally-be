import { ChatEvents } from '../constants/chat.constants';

export type UserChatSessionData = {
  type: 'user';
  userId: number;
  user: any;
  role: string;
  room: string;
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
