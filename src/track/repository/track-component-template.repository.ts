import { Injectable } from '@nestjs/common';
import { DataSource, ILike, Repository } from 'typeorm';
import { TrackComponentTemplate } from '../entity/track-component-template.entity';
import { TrackItemType } from '../type/track.type';

export interface TrackComponentTemplateListOptions {
  type?: TrackItemType;
  search?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class TrackComponentTemplateRepository extends Repository<TrackComponentTemplate> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackComponentTemplate, dataSource.createEntityManager());
  }

  async listTemplates(
    options: TrackComponentTemplateListOptions,
  ): Promise<{ items: TrackComponentTemplate[]; total: number }> {
    const { type, search, limit, offset } = options;

    const [items, total] = await this.findAndCount({
      where: {
        ...(type ? { type } : {}),
        ...(search ? { title: ILike(`%${search}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }
}
