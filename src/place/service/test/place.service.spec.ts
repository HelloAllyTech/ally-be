import { Test, TestingModule } from '@nestjs/testing';
import { PlaceService } from '../../../place/service/place.service';
import { Place } from '../../../place/entity/place.entity';
import { PlaceRepository } from '../../../place/repository/place.repository';

describe('PlaceService', () => {
  let service: PlaceService;
  let mockPlaceRepository: any;

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
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

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

    it('should return empty array when no cities match', async () => {
      const query = 'NonexistentCity';
      mockPlaceRepository.searchCities.mockResolvedValue([]);

      const result = await service.searchCities(query);

      expect(mockPlaceRepository.searchCities).toHaveBeenCalledWith(query);
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
      mockPlaceRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await service.listPlaces(page, limit);

      expect(mockPlaceRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should list places with default pagination parameters', async () => {
      const expectedData = [mockPlace];
      const expectedTotal = 10;
      mockPlaceRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await service.listPlaces();

      expect(mockPlaceRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 0, // (1 - 1) * 10
        take: 10,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should return empty result when no places exist', async () => {
      mockPlaceRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listPlaces();

      expect(result).toEqual({ data: [], total: 0 });
    });

    it('should handle first page correctly', async () => {
      const page = 1;
      const limit = 20;
      const expectedData = [mockPlace];
      const expectedTotal = 5;
      mockPlaceRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await service.listPlaces(page, limit);

      expect(mockPlaceRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should calculate correct offset for page 3', async () => {
      const page = 3;
      const limit = 15;
      mockPlaceRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.listPlaces(page, limit);

      expect(mockPlaceRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 30, // (3 - 1) * 15
        take: 15,
      });
    });
  });

  describe('createPlace', () => {
    it('should create a new place', async () => {
      const city = '  Los Angeles  ';
      const state = '  CA  ';
      const createdPlace = { ...mockPlace, city: 'Los Angeles', state: 'CA' };
      mockPlaceRepository.create.mockReturnValue(createdPlace);
      mockPlaceRepository.save.mockResolvedValue(createdPlace);

      const result = await service.createPlace(city, state);

      expect(mockPlaceRepository.create).toHaveBeenCalledWith({
        city: city.trim(),
        state: state.trim(),
      });
      expect(mockPlaceRepository.save).toHaveBeenCalledWith(createdPlace);
      expect(result).toEqual(createdPlace);
    });

    it('should trim whitespace from city and state before creating', async () => {
      const city = '  San Francisco  ';
      const state = '  California  ';
      const createdPlace = {
        ...mockPlace,
        city: 'San Francisco',
        state: 'California',
      };
      mockPlaceRepository.create.mockReturnValue(createdPlace);
      mockPlaceRepository.save.mockResolvedValue(createdPlace);

      await service.createPlace(city, state);

      expect(mockPlaceRepository.create).toHaveBeenCalledWith({
        city: 'San Francisco',
        state: 'California',
      });
    });

    it('should create place with no whitespace', async () => {
      const city = 'Chicago';
      const state = 'IL';
      const createdPlace = { ...mockPlace, city, state };
      mockPlaceRepository.create.mockReturnValue(createdPlace);
      mockPlaceRepository.save.mockResolvedValue(createdPlace);

      const result = await service.createPlace(city, state);

      expect(mockPlaceRepository.create).toHaveBeenCalledWith({
        city,
        state,
      });
      expect(result).toEqual(createdPlace);
    });
  });
});
