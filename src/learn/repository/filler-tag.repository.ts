import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { FillerTag } from '../entity/filler-tag.entity';
import { Pagination, SortOrder } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class FillerTagRepository extends Repository<FillerTag> {
  private readonly logger = LoggerService.getInstance(FillerTagRepository.name);

  constructor(private dataSource: DataSource) {
    super(FillerTag, dataSource.createEntityManager());
  }

  async getFillerTags(name?: string, options?: Pagination) {
    const query = this.createQueryBuilder('filler_tag');
    this.logger.info(`Getting filler tags with name: ${name}`);
    if (name) {
      const searchTerm = `%${name.trim()}%`;
      query.where('filler_tag.name ILIKE :name', { name: searchTerm });
    }
    if (options) {
      query.orderBy('filler_tag.createdAt', options.order || SortOrder.DESC);
      if (options.offset != null) {
        query.offset(options.offset);
      }
      if (options.limit != null) {
        query.limit(options.limit);
      }
    }
    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }
}
