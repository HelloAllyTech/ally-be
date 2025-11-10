import { Test, TestingModule } from '@nestjs/testing';
import { PlaceService } from '../../../place/service/place.service';
import { Place } from '../../../place/entity/place.entity';
import { PlaceRepository } from '../../repository/place.repository';

describe('PlaceService', () => {
  let service: PlaceService;
  let mockPlaceRepository: jest.Mocked<PlaceRepository>;

  const mockPlace: Place = {
    id: 1,
    city: 'New York',
    state: 'NY',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Place;

  beforeEach(async () => {
    mockPlaceRepository = {
      searchCities: jest.fn(),
      listPlaces: jest.fn(),
      createPlace: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaceService,
        {
          provide: PlaceRepository,
          useValue: mockPlaceRepository,
        },
      ],
    }).compile();

    service = module.get<PlaceService>(PlaceService);
  });

  describe('searchCities', () => {
    it('should search cities with query', async () => {
      const query = 'New York';
      const expectedPlaces = [mockPlace];
      mockPlaceRepository.searchCities.mockResolvedValue(expectedPlaces);

      const result = await service.searchCities(query);

      expect(mockPlaceRepository.searchCities).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedPlaces);
    });

    it('should return result from repository', async () => {
      const query = '  Los Angeles  ';
      const expectedPlaces = [mockPlace];
      mockPlaceRepository.searchCities.mockResolvedValue(expectedPlaces);

      const result = await service.searchCities(query);

      expect(mockPlaceRepository.searchCities).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedPlaces);
    });

    it('should return empty array when no cities match', async () => {
      const query = 'NonexistentCity';
      mockPlaceRepository.searchCities.mockResolvedValue([]);

      const result = await service.searchCities(query);

      expect(result).toEqual([]);
    });

    it('should handle empty string query', async () => {
      const query = '';
      mockPlaceRepository.searchCities.mockResolvedValue([]);

      await service.searchCities(query);

      expect(mockPlaceRepository.searchCities).toHaveBeenCalledWith(query);
    });
  });

  describe('listPlaces', () => {
    it('should list places with pagination', async () => {
      const page = 2;
      const limit = 5;
      const expectedData = [mockPlace];
      const expectedTotal = 10;
      mockPlaceRepository.listPlaces.mockResolvedValue({
        data: expectedData,
        total: expectedTotal,
      });

      const result = await service.listPlaces(page, limit);

      expect(mockPlaceRepository.listPlaces).toHaveBeenCalledWith(page, limit);
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should list places with default pagination parameters', async () => {
      const expectedData = [mockPlace];
      const expectedTotal = 10;
      mockPlaceRepository.listPlaces.mockResolvedValue({
        data: expectedData,
        total: expectedTotal,
      });

      const result = await service.listPlaces();

      expect(mockPlaceRepository.listPlaces).toHaveBeenCalledWith(1, 10);
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should return empty result when no places exist', async () => {
      mockPlaceRepository.listPlaces.mockResolvedValue({ data: [], total: 0 });

      const result = await service.listPlaces();

      expect(result).toEqual({ data: [], total: 0 });
    });

    it('should handle first page correctly', async () => {
      const page = 1;
      const limit = 20;
      const expectedData = [mockPlace];
      const expectedTotal = 5;
      mockPlaceRepository.listPlaces.mockResolvedValue({
        data: expectedData,
        total: expectedTotal,
      });

      const result = await service.listPlaces(page, limit);

      expect(mockPlaceRepository.listPlaces).toHaveBeenCalledWith(page, limit);
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should calculate correct offset for page 3', async () => {
      const page = 3;
      const limit = 15;
      mockPlaceRepository.listPlaces.mockResolvedValue({ data: [], total: 0 });

      await service.listPlaces(page, limit);

      expect(mockPlaceRepository.listPlaces).toHaveBeenCalledWith(page, limit);
    });
  });

  describe('createPlace', () => {
    it('should create a new place', async () => {
      const city = '  Los Angeles  ';
      const state = '  CA  ';
      const createdPlace = { ...mockPlace, city: 'Los Angeles', state: 'CA' };
      mockPlaceRepository.createPlace.mockResolvedValue(createdPlace);

      const result = await service.createPlace(city, state);

      expect(mockPlaceRepository.createPlace).toHaveBeenCalledWith(city, state);
      expect(result).toEqual(createdPlace);
    });

    it('should delegate to repository for creating places', async () => {
      const city = '  San Francisco  ';
      const state = '  California  ';
      const createdPlace = {
        ...mockPlace,
        city: 'San Francisco',
        state: 'California',
      };
      mockPlaceRepository.createPlace.mockResolvedValue(createdPlace);

      const result = await service.createPlace(city, state);

      expect(mockPlaceRepository.createPlace).toHaveBeenCalledWith(city, state);
      expect(result).toEqual(createdPlace);
    });

    it('should create place with no whitespace', async () => {
      const city = 'Chicago';
      const state = 'IL';
      const createdPlace = { ...mockPlace, city, state };
      mockPlaceRepository.createPlace.mockResolvedValue(createdPlace);

      const result = await service.createPlace(city, state);

      expect(mockPlaceRepository.createPlace).toHaveBeenCalledWith(city, state);
      expect(result).toEqual(createdPlace);
    });
  });
});
