import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, IsNull, Repository } from 'typeorm';

import {
  UpdateAudience,
  UpdateSurface,
} from '../constants/product-update.constants';
import { ProductUpdate } from '../entity/product-update.entity';

export interface AdminUpdateFilters {
  status?: 'live' | 'merged';
  audience?: UpdateAudience;
  surface?: UpdateSurface;
  hidden?: boolean;
  search?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class ProductUpdateRepository extends Repository<ProductUpdate> {
  constructor(private readonly dataSource: DataSource) {
    super(ProductUpdate, dataSource.createEntityManager());
  }

  /**
   * The public changelog: public, live and not hidden, newest live date first.
   * The same three conditions `isPublic` checks — kept in one place each so
   * the page and the digest cannot disagree about what is public.
   */
  async findPublic(params: {
    limit: number;
    offset: number;
    surface?: UpdateSurface;
  }): Promise<{ updates: ProductUpdate[]; count: number }> {
    const qb = this.createQueryBuilder('u')
      .where('u.audience = :audience', { audience: 'public' })
      .andWhere('u.hidden = false')
      .andWhere('u.liveAt IS NOT NULL');
    if (params.surface) {
      qb.andWhere(':surface = ANY(u.surfaces)', { surface: params.surface });
    }
    const [updates, count] = await qb
      .orderBy('u.liveAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .limit(params.limit)
      .offset(params.offset)
      .getManyAndCount();
    return { updates, count };
  }

  /**
   * Updates a new merge may still be attached to: something merged within
   * `mergedSince`, and either not yet public or published after
   * `publishedSince`. Beyond that window a follow-up becomes its own update —
   * an announcement a week old is not rewritten.
   */
  async findOpen(params: {
    mergedSince: Date;
    publishedSince: Date;
    limit: number;
  }): Promise<ProductUpdate[]> {
    return this.createQueryBuilder('u')
      .leftJoinAndSelect('u.sources', 's')
      .where('u.lastMergedAt >= :mergedSince', {
        mergedSince: params.mergedSince,
      })
      .andWhere(
        new Brackets((qb) =>
          qb
            .where('u.publishedAt IS NULL')
            .orWhere('u.publishedAt >= :publishedSince', {
              publishedSince: params.publishedSince,
            }),
        ),
      )
      .orderBy('u.lastMergedAt', 'DESC')
      .take(params.limit)
      .getMany();
  }

  async findNotLive(): Promise<ProductUpdate[]> {
    return this.find({
      where: { liveAt: IsNull() },
      relations: { sources: true },
    });
  }

  async findAdmin(
    filters: AdminUpdateFilters,
  ): Promise<{ updates: ProductUpdate[]; count: number }> {
    const qb = this.createQueryBuilder('u');
    if (filters.status === 'live') qb.andWhere('u.liveAt IS NOT NULL');
    if (filters.status === 'merged') qb.andWhere('u.liveAt IS NULL');
    if (filters.audience) {
      qb.andWhere('u.audience = :audience', { audience: filters.audience });
    }
    if (filters.surface) {
      qb.andWhere(':surface = ANY(u.surfaces)', { surface: filters.surface });
    }
    if (filters.hidden !== undefined) {
      qb.andWhere('u.hidden = :hidden', { hidden: filters.hidden });
    }
    if (filters.search?.trim()) {
      qb.andWhere(
        new Brackets((inner) =>
          inner
            .where('u.title ILIKE :search')
            .orWhere('u.summary ILIKE :search')
            .orWhere('u.teamNotes ILIKE :search'),
        ),
        { search: `%${filters.search.trim()}%` },
      );
    }
    const [updates, count] = await qb
      .orderBy('u.lastMergedAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .limit(filters.limit)
      .offset(filters.offset)
      .getManyAndCount();
    return { updates, count };
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.count({ where: { slug }, withDeleted: false })) > 0;
  }
}
