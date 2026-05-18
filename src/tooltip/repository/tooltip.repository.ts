import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { Tooltip } from '../entity/tooltip.entity';

interface TooltipQueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
}

@Injectable()
export class TooltipRepository extends Repository<Tooltip> {
  constructor(private readonly dataSource: DataSource) {
    super(Tooltip, dataSource.createEntityManager());
  }

  async getTooltips(
    search?: string,
    options?: TooltipQueryOptions,
  ): Promise<Tooltip[]> {
    const qb = this.createQueryBuilder('tooltip');

    if (search) {
      qb.where(
        'tooltip.location ILIKE :search OR tooltip.tipText ILIKE :search',
        { search: `%${search}%` },
      );
    }

    const sortBy = options?.sortBy || 'createdAt';
    const order = options?.order || 'DESC';
    qb.orderBy(`tooltip.${sortBy}`, order);

    if (options?.limit != null) qb.take(options.limit);
    if (options?.offset != null) qb.skip(options.offset);

    return qb.getMany();
  }

  async getActiveTooltips(): Promise<Pick<Tooltip, 'id' | 'location' | 'tipText' | 'icon'>[]> {
    return this.createQueryBuilder('tooltip')
      .select(['tooltip.id', 'tooltip.location', 'tooltip.tipText', 'tooltip.icon'])
      .where('tooltip.active = :active', { active: true })
      .orderBy('tooltip.location', 'ASC')
      .getMany();
  }
}
