import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RatingMetadata } from '../entity/rating-metadata.entity';

@Injectable()
export class RatingMetadataService {
  // private cache: RatingMetadata[] | null = null;

  constructor(
    @InjectRepository(RatingMetadata)
    private readonly ratingMetadataRepository: Repository<RatingMetadata>,
  ) {}

  async getAll(): Promise<RatingMetadata[]> {
    // if (this.cache) {
    //   return this.cache;
    // }
    const rows = await this.ratingMetadataRepository.find({
      order: { rating: 'ASC' },
    });
    // this.cache = rows;
    return rows;
  }
}
