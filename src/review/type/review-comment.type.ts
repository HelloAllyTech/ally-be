export interface ReviewComment {
  comment_id: string;
  comment_reviewThreadId: string;
  comment_content: string;
  comment_createdBy: number;
  comment_parentCommentId: string | null;
  comment_hidden: boolean;
  comment_deletedAt: Date | null;
  comment_createdAt: Date;
  comment_updatedAt: Date;
  comment_tenantId: string;
  reply_count: string;
}

export interface GetCommentsByThreadIdResult {
  comments: ReviewComment[];
  count: number;
}

export interface CommentForThreadIdsResult extends ReviewComment {
  row_num: number;
}
