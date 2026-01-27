export interface ReviewReactionCount {
  reviewId: string;
  reaction: string;
  count: string;
}

export interface ReactionCount {
  reaction: string;
  count: string;
}

export enum ReactionAction {
  ADD = 'ADD',
  REMOVE = 'REMOVE',
  UPDATE = 'UPDATE',
}

export interface ReviewReactionOptions {
  limit?: number;
  offset?: number;
  reaction?: string;
}
