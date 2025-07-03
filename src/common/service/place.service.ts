import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Place } from '../entities/place.entity';

@Injectable()
export class PlaceService {
  constructor(
    @InjectRepository(Place)
    private placeRepository: Repository<Place>,
  ) {}

  async searchCities(query: string): Promise<Place[]> {
    return this.placeRepository
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
  ): Promise<{ data: Place[]; total: number }> {
    const [data, total] = await this.placeRepository.findAndCount({
      order: {
        city: 'ASC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async createPlace(city: string, state: string): Promise<Place> {
    const place = this.placeRepository.create({
      city: city.trim(),
      state: state.trim(),
    });
    return this.placeRepository.save(place);
  }
}
