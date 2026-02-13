import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioCoverImageLibrary } from '../entity/scenario-cover-image-library.entity';
import {
  ScenarioCoverImageLibrarySortBy,
  ScenarioCoverImageLibrarySortOrder,
} from '../dto/get-scenario-cover-image-library.dto';
import { GetScenarioCoverImageLibraryOptions } from '../type/scenario-cover-image-library.type';

@Injectable()
export class ScenarioCoverImageLibraryRepository extends Repository<ScenarioCoverImageLibrary> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioCoverImageLibrary, dataSource.createEntityManager());
  }

  async getCoverImages(
    options: GetScenarioCoverImageLibraryOptions = {},
  ): Promise<{ coverImages: ScenarioCoverImageLibrary[]; count: number }> {
    const {
      limit = 20,
      offset = 0,
      sortBy = ScenarioCoverImageLibrarySortBy.CREATED_AT,
      sortOrder = ScenarioCoverImageLibrarySortOrder.DESC,
    } = options;

    const query = this.createQueryBuilder('coverImageLibrary')
      .orderBy(
        `coverImageLibrary.${sortBy}`,
        sortOrder.toUpperCase() as 'ASC' | 'DESC',
      )
      .limit(limit)
      .offset(offset);

    const [coverImages, count] = await query.getManyAndCount();
    return { coverImages, count };
  }
}
