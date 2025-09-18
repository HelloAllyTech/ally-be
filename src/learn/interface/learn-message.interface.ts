import { MessageRequest } from 'src/ai/dto/ai.request.dto';

export interface LearnMessageAndEventMessage {
  message_type: string;
  timestamp: number;
  room_id: string;
  data: LearnData;
}

export interface LearnData {
  chat_message?: MessageRequest;
  event?: LearnEventData;
}

export interface LearnEventData {
  event_id: string;
  timestamp: Date;
}
