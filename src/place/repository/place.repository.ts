import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Place } from '../entity/place.entity';

@Injectable()
export class PlaceRepository extends Repository<Place> {
  constructor(private dataSource: DataSource) {
    super(Place, dataSource.createEntityManager());
  }

  async searchCities(
    query: string,
    entityManager?: EntityManager,
  ): Promise<Place[]> {
    const repository = entityManager
      ? entityManager.getRepository(Place)
      : this;
    return repository
      .createQueryBuilder('place')
      .where('LOWER(place.city) LIKE LOWER(:query)', {
        query: `%${query.trim()}%`,
      })
      .orderBy('place.city', 'ASC')
      .getMany();
  }

  async listPlaces(
    page: number = 1,
    limit: number = 10,
    entityManager?: EntityManager,
  ): Promise<{ data: Place[]; total: number }> {
    const repository = entityManager
      ? entityManager.getRepository(Place)
      : this;
    const [data, total] = await repository.findAndCount({
      order: {
        city: 'ASC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async createPlace(
    city: string,
    state: string,
    entityManager?: EntityManager,
  ): Promise<Place> {
    const repository = entityManager
      ? entityManager.getRepository(Place)
      : this;
    const place = repository.create({
      city: city.trim(),
      state: state.trim(),
    });
    return repository.save(place);
  }
}
