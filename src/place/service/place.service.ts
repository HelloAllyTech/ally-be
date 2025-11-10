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
    return this.placeRepository.listPlaces(page, limit);
  }

  async createPlace(city: string, state: string): Promise<Place> {
    return this.placeRepository.createPlace(city, state);
  }
}
