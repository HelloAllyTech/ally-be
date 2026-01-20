import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewComment } from '../entity/review-comment.entity';
import { Pagination } from 'src/common/type/common.type';

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
}
