import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PlaceController } from '../place.controller';
import { PlaceService } from '../../service/place.service';
import { Place } from '../../entities/place.entity';

describe('PlaceController', () => {
  let controller: PlaceController;
  let mockPlaceService: any;

  const mockPlace: Place = {
    id: 1,
    city: 'New York',
    state: 'NY',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  } as Place;

  const mockPlaces: Place[] = [mockPlace];

  const mockListResponse = {
    data: mockPlaces,
    total: 1,
  };

  beforeEach(async () => {
    mockPlaceService = {
      searchCities: jest.fn(),
      listPlaces: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaceController],
      providers: [{ provide: PlaceService, useValue: mockPlaceService }],
    }).compile();

    controller = module.get<PlaceController>(PlaceController);
  });

  describe('searchCities', () => {
    it('should throw BadRequestException when query is empty', async () => {
      await expect(controller.searchCities('')).rejects.toThrow(
        new BadRequestException('Query parameter cannot be empty'),
      );
      expect(mockPlaceService.searchCities).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when query is too long', async () => {
      const longQuery = 'a'.repeat(101);
      await expect(controller.searchCities(longQuery)).rejects.toThrow(
        new BadRequestException('Query parameter too long'),
      );
      expect(mockPlaceService.searchCities).not.toHaveBeenCalled();
    });

    it('should return search results for valid query', async () => {
      const query = 'New York';
      mockPlaceService.searchCities.mockResolvedValue(mockPlaces);

      const result = await controller.searchCities(query);

      expect(mockPlaceService.searchCities).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockPlaces);
    });
  });

  describe('listPlaces', () => {
    it('should throw BadRequestException when page is less than 1', async () => {
      await expect(controller.listPlaces(0, 10)).rejects.toThrow(
        new BadRequestException('Page must be greater than or equal to 1'),
      );
      expect(mockPlaceService.listPlaces).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when limit is invalid', async () => {
      await expect(controller.listPlaces(1, 0)).rejects.toThrow(
        new BadRequestException('Limit must be between 1 and 100'),
      );
      await expect(controller.listPlaces(1, 101)).rejects.toThrow(
        new BadRequestException('Limit must be between 1 and 100'),
      );
      expect(mockPlaceService.listPlaces).not.toHaveBeenCalled();
    });

    it('should return places list for valid parameters', async () => {
      const page = 1;
      const limit = 10;
      mockPlaceService.listPlaces.mockResolvedValue(mockListResponse);

      const result = await controller.listPlaces(page, limit);

      expect(mockPlaceService.listPlaces).toHaveBeenCalledWith(page, limit);
      expect(result).toEqual(mockListResponse);
    });
  });
});
