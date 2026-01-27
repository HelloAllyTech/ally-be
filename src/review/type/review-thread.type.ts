import { Pagination } from 'src/common/type/common.type';

export interface GetReviewThreadsOptions extends Pagination {
  includeMessage?: boolean;
}

export interface ReviewCommentCount {
  reviewId: string;
  count: number;
}
