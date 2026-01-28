import { DataSource, Repository } from 'typeorm';
import { Place } from '../entity/place.entity';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

@Injectable()
export class PlaceRepository extends Repository<Place> {
  constructor(private readonly dataSource: DataSource) {
    super(Place, dataSource.createEntityManager());
  }

  async searchCities(query: string, em?: EntityManager): Promise<Place[]> {
    const repo = em?.getRepository(Place) || this;

    return repo
      .createQueryBuilder('place')
      .where('place.city ILIKE :query', {
        query: `%${query.trim()}%`,
      })
      .orderBy('place.city', 'ASC')
      .getMany();
  }
}
