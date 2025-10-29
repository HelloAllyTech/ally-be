import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioVoicesRepository } from '../scenario-voices.repository';
import { ScenarioVoices } from '../../entity/scenario-voices.entity';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { ScenarioVoiceSortBy } from '../../enum/scenario-voice-sort-by.enum';

describe('ScenarioVoicesRepository', () => {
  let repository: ScenarioVoicesRepository;
  let dataSource: jest.Mocked<DataSource>;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<ScenarioVoices>>;

  beforeEach(async () => {
    queryBuilder = {
      createQueryBuilder: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioVoicesRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenarioVoicesRepository>(ScenarioVoicesRepository);
    // Mock the createQueryBuilder method on the repository
    jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(queryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioVoices', () => {
    it('should return scenario voices with default pagination and sorting', async () => {
      const mockVoices = [
        {
          id: 'voice-1',
          name: 'Voice 1',
          voiceId: 'openai-voice-1',
          provider: 'openai',
          config: {},
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'voice-2',
          name: 'Voice 2',
          voiceId: 'openai-voice-2',
          provider: 'openai',
          config: {},
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      queryBuilder.getMany.mockResolvedValue(mockVoices as any);

      const result = await repository.getScenarioVoices({
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockVoices);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'scenarioVoice',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioVoice.createdAt',
        'ASC',
      );
      expect(queryBuilder.offset).toHaveBeenCalledWith(0);
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply custom sort by name in descending order', async () => {
      const mockVoices = [
        {
          id: 'voice-2',
          name: 'Voice 2',
          voiceId: 'openai-voice-2',
          provider: 'openai',
          config: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      queryBuilder.getMany.mockResolvedValue(mockVoices as any);

      const result = await repository.getScenarioVoices({
        limit: 5,
        offset: 0,
        sortBy: ScenarioVoiceSortBy.NAME,
        order: SortOrder.DESC,
      });

      expect(result).toEqual(mockVoices);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioVoice.name',
        SortOrder.DESC,
      );
    });

    it('should apply custom pagination with offset', async () => {
      const mockVoices: ScenarioVoices[] = [];

      queryBuilder.getMany.mockResolvedValue(mockVoices);

      await repository.getScenarioVoices({
        limit: 20,
        offset: 40,
      });

      expect(queryBuilder.offset).toHaveBeenCalledWith(40);
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
    });

    it('should handle empty result set', async () => {
      const mockVoices: ScenarioVoices[] = [];

      queryBuilder.getMany.mockResolvedValue(mockVoices);

      const result = await repository.getScenarioVoices({
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual([]);
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply sort by provider', async () => {
      const mockVoices: ScenarioVoices[] = [
        {
          id: 'voice-1',
          name: 'Voice 1',
          voiceId: 'openai-voice-1',
          provider: 'openai',
          config: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioVoices,
      ];

      queryBuilder.getMany.mockResolvedValue(mockVoices as any);

      await repository.getScenarioVoices({
        limit: 10,
        offset: 0,
        sortBy: ScenarioVoiceSortBy.PROVIDER,
        order: SortOrder.ASC,
      });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioVoice.provider',
        SortOrder.ASC,
      );
    });

    it('should apply sort by created_at', async () => {
      const mockVoices: ScenarioVoices[] = [];

      queryBuilder.getMany.mockResolvedValue(mockVoices);

      await repository.getScenarioVoices({
        limit: 10,
        offset: 0,
        sortBy: ScenarioVoiceSortBy.CREATED_AT,
        order: SortOrder.DESC,
      });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'scenarioVoice.createdAt',
        SortOrder.DESC,
      );
    });

    it('should use default limit when not provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.getScenarioVoices({
        offset: 0,
      } as any);

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should use default offset when not provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.getScenarioVoices({
        limit: 10,
      } as any);

      expect(queryBuilder.offset).toHaveBeenCalledWith(0);
    });
  });
});
