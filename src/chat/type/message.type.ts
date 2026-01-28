import { MessageType } from '../entity/message.entity';

export interface MessageFilter {
  type?: MessageType;
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
}
