import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PlaceRepository } from '../place.repository';
import { Place } from '../../entity/place.entity';

describe('PlaceRepository', () => {
  let repository: PlaceRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let mockRepository: jest.Mocked<Repository<Place>>;

  const mockPlace: Place = {
    id: 1,
    city: 'New York',
    state: 'NY',
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  } as Place;

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;

    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaceRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<PlaceRepository>(PlaceRepository);
    dataSource = module.get(DataSource);
    entityManager = mockEntityManager;

    // Spy on inherited Repository methods
    jest.spyOn(repository, 'create').mockImplementation(mockRepository.create);
    jest.spyOn(repository, 'save').mockImplementation(mockRepository.save);
    jest
      .spyOn(repository, 'findAndCount')
      .mockImplementation(mockRepository.findAndCount);
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockImplementation(mockRepository.createQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchCities', () => {
    it('should search cities with query', async () => {
      const query = 'New York';
      const expectedPlaces = [mockPlace];
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(expectedPlaces),
      };

      mockRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      const result = await repository.searchCities(query);

      expect(result).toEqual(expectedPlaces);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('place');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'LOWER(place.city) LIKE LOWER(:query)',
        { query: `%${query.trim()}%` },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'place.city',
        'ASC',
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should trim whitespace from search query', async () => {
      const query = '  Los Angeles  ';
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      await repository.searchCities(query);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'LOWER(place.city) LIKE LOWER(:query)',
        { query: '%Los Angeles%' },
      );
    });

    it('should return empty array when no cities match', async () => {
      const query = 'NonexistentCity';
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      const result = await repository.searchCities(query);

      expect(result).toEqual([]);
    });

    it('should handle empty string query', async () => {
      const query = '';
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      await repository.searchCities(query);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'LOWER(place.city) LIKE LOWER(:query)',
        { query: '%%' },
      );
    });

    it('should use entity manager if provided', async () => {
      const query = 'New York';
      const expectedPlaces = [mockPlace];
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(expectedPlaces),
      };

      const emRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.searchCities(query, entityManager);

      expect(result).toEqual(expectedPlaces);
      expect(entityManager.getRepository).toHaveBeenCalledWith(Place);
      expect(emRepository.createQueryBuilder).toHaveBeenCalledWith('place');
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  describe('listPlaces', () => {
    it('should list places with pagination', async () => {
      const page = 2;
      const limit = 5;
      const expectedData = [mockPlace];
      const expectedTotal = 10;

      mockRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await repository.listPlaces(page, limit);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should list places with default pagination parameters', async () => {
      const expectedData = [mockPlace];
      const expectedTotal = 10;

      mockRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await repository.listPlaces();

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 0,
        take: 10,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should return empty result when no places exist', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await repository.listPlaces();

      expect(result).toEqual({ data: [], total: 0 });
    });

    it('should handle first page correctly', async () => {
      const page = 1;
      const limit = 20;
      const expectedData = [mockPlace];
      const expectedTotal = 5;

      mockRepository.findAndCount.mockResolvedValue([
        expectedData,
        expectedTotal,
      ]);

      const result = await repository.listPlaces(page, limit);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ data: expectedData, total: expectedTotal });
    });

    it('should calculate correct offset for page 3', async () => {
      const page = 3;
      const limit = 15;

      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await repository.listPlaces(page, limit);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 30,
        take: 15,
      });
    });

    it('should use entity manager if provided', async () => {
      const page = 1;
      const limit = 10;
      const expectedData = [mockPlace];
      const expectedTotal = 5;

      const emRepository = {
        findAndCount: jest
          .fn()
          .mockResolvedValue([expectedData, expectedTotal]),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.listPlaces(page, limit, entityManager);

      expect(result).toEqual({ data: expectedData, total: expectedTotal });
      expect(entityManager.getRepository).toHaveBeenCalledWith(Place);
      expect(emRepository.findAndCount).toHaveBeenCalledWith({
        order: { city: 'ASC' },
        skip: 0,
        take: 10,
      });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  describe('createPlace', () => {
    it('should create a new place', async () => {
      const city = '  Los Angeles  ';
      const state = '  CA  ';
      const createdPlace = { ...mockPlace, city: 'Los Angeles', state: 'CA' };

      jest.spyOn(repository, 'create').mockReturnValue(createdPlace);
      jest.spyOn(repository, 'save').mockResolvedValue(createdPlace);

      const result = await repository.createPlace(city, state);

      expect(repository.create).toHaveBeenCalledWith({
        city: city.trim(),
        state: state.trim(),
      });
      expect(repository.save).toHaveBeenCalledWith(createdPlace);
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

      jest.spyOn(repository, 'create').mockReturnValue(createdPlace);
      jest.spyOn(repository, 'save').mockResolvedValue(createdPlace);

      await repository.createPlace(city, state);

      expect(repository.create).toHaveBeenCalledWith({
        city: 'San Francisco',
        state: 'California',
      });
    });

    it('should create place with no whitespace', async () => {
      const city = 'Chicago';
      const state = 'IL';
      const createdPlace = { ...mockPlace, city, state };

      jest.spyOn(repository, 'create').mockReturnValue(createdPlace);
      jest.spyOn(repository, 'save').mockResolvedValue(createdPlace);

      const result = await repository.createPlace(city, state);

      expect(repository.create).toHaveBeenCalledWith({
        city,
        state,
      });
      expect(result).toEqual(createdPlace);
    });

    it('should use entity manager if provided', async () => {
      const city = 'Boston';
      const state = 'MA';
      const createdPlace = { ...mockPlace, city, state };

      const emRepository = {
        create: jest.fn().mockReturnValue(createdPlace),
        save: jest.fn().mockResolvedValue(createdPlace),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.createPlace(city, state, entityManager);

      expect(result).toEqual(createdPlace);
      expect(entityManager.getRepository).toHaveBeenCalledWith(Place);
      expect(emRepository.create).toHaveBeenCalledWith({
        city,
        state,
      });
      expect(emRepository.save).toHaveBeenCalledWith(createdPlace);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      const city = 'Seattle';
      const state = 'WA';
      const createdPlace = { ...mockPlace, city, state };
      const error = new Error('Database error');

      jest.spyOn(repository, 'create').mockReturnValue(createdPlace);
      jest.spyOn(repository, 'save').mockRejectedValue(error);

      await expect(repository.createPlace(city, state)).rejects.toThrow(
        'Database error',
      );
    });
  });
});
