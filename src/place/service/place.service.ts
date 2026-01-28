import { Injectable } from '@nestjs/common';
import { Place } from '../entity/place.entity';
import { PlaceRepository } from '../repository/place.repository';

@Injectable()
export class PlaceService {
  constructor(private placeRepository: PlaceRepository) {}

  async searchCities(query: string): Promise<Place[]> {
    return this.placeRepository.searchCities(query);
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
