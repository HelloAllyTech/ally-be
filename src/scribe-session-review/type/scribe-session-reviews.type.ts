import { CallDetails } from 'src/chat/entity/call.details.entity';
import { Chat } from 'src/chat/entity/chat.entity';

import { User } from 'src/user/entity/user.entity';

export interface ScribeSessionReviews {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: string;
  scribeSessionId: number;
  createdBy: User;
  status: string;
  chat: Chat;
  callDetails: CallDetails;
  note?: string | null;
  noteEditedAt?: Date | null;
}

export interface ScribeSessionReviewsResult {
  reviews: ScribeSessionReviews[];
  count: number;
}

export interface GetScribeSessionReviews {
  reviews: ScribeSessionReviews[];
  count: number;
  reactions: Array<{ reviewId: string; reaction: string; count: string }>;
  comments: Array<{ reviewId: string; count: number }>;
}
