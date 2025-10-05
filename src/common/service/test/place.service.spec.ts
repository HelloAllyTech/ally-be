import { Test, TestingModule } from '@nestjs/testing';
import { PlaceService } from '../place.service';
import { Place } from '../../entities/place.entity';

describe('PlaceService', () => {
  let service: PlaceService;
  let mockPlaceRepository: any;
  let mockQueryBuilder: any;

  const mockPlace: Place = {
    id: 1,
    city: 'New York',
    state: 'NY',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Place;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    mockPlaceRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaceService,
        {
          provide: 'PlaceRepository', // getRepositoryToken(Place)
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
      mockQueryBuilder.getMany.mockResolvedValue(expectedPlaces);

      const result = await service.searchCities(query);

      expect(mockPlaceRepository.createQueryBuilder).toHaveBeenCalledWith(
        'place',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'LOWER(place.city) LIKE LOWER(:query)',
        { query: `%${query.trim()}%` },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'place.city',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedPlaces);
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
  });
});
