import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewComment } from '../entity/review-comment.entity';
import { Pagination } from 'src/common/type/common.type';
import { ReviewThread } from '../entity/review-thread.entity';
import { Review } from '../entity/review.entity';

@Injectable()
export class ReviewCommentRepository extends Repository<ReviewComment> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewComment, dataSource.createEntityManager());
  }

  async getCommentsForThreadIds(
    threadIds: string[],
    isHidden: boolean,
  ): Promise<any[]> {
    if (!threadIds.length) return [];

    const query = this.createQueryBuilder('c')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ReviewComment, 'rc')
          .where('rc.parentCommentId = c.id');
      }, 'reply_count')
      .addSelect(
        `ROW_NUMBER() OVER (PARTITION BY c."reviewThreadId" ORDER BY c."createdAt" ASC)`,
        'row_num',
      )
      .where('c.reviewThreadId IN (:...threadIds)', { threadIds })
      .andWhere('c.parentCommentId IS NULL');

    if (!isHidden) {
      query.andWhere('c.hidden = false');
    }
    return query.addOrderBy('c.createdAt', 'ASC').getRawMany();
  }

  async getCommentsByThreadId(
    threadId: string,
    isHidden: boolean,
    options?: Pagination,
  ) {
    const { limit = 20, offset = 0 } = options || {};

    const query = this.createQueryBuilder('c')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'count')
          .from(ReviewComment, 'rc')
          .where('rc.parentCommentId = c.id')
          .andWhere('rc.deletedAt IS NULL');
      }, 'reply_count')
      .where('c.reviewThreadId = :threadId', { threadId })
      .andWhere('c.parentCommentId IS NULL');

    if (!isHidden) {
      query.andWhere('(c.hidden = false)');
    }

    const count = await query.getCount();

    const comments = await query
      .orderBy('c.createdAt', 'ASC')
      .limit(limit)
      .offset(offset)
      .getRawMany();

    return { comments, count };
  }

  async getRepliesByCommentId(
    commentId: string,
    isHidden: boolean,
    options?: Pagination,
  ) {
    const { limit = 20, offset = 0 } = options || {};
    const query = this.createQueryBuilder('c').where(
      'c.parentCommentId = :commentId',
      { commentId },
    );
    if (!isHidden) {
      query.andWhere('c.hidden=false');
    }

    query.orderBy('c.createdAt', 'ASC').limit(limit).offset(offset);
    return query.getManyAndCount();
  }

  async getGivenCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rc')
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
      .where('r.createdBy != rc.createdBy')
      .select('rc.createdBy', 'userId')
      .addSelect('COUNT(rc.id)', 'count')
      .groupBy('rc.createdBy');

    if (userIds) {
      query.andWhere('rc.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('rc.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getReceivedCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rc')
      .innerJoin(ReviewThread, 'rt', 'rt.id = rc.reviewThreadId')
      .innerJoin(Review, 'r', 'r.id = rt.reviewId')
      .where('r.createdBy != rc.createdBy')
      .select('r.createdBy', 'userId')
      .addSelect('COUNT(rc.id)', 'count')
      .groupBy('r.createdBy');

    if (userIds) {
      query.andWhere('r.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('r.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }
}
