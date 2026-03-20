import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioVoicesRepository } from '../scenario-voices.repository';
import { ScenarioVoices } from '../../entity/scenario-voices.entity';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { ScenarioVoiceSortBy } from '../../enum/scenario-voice-sort-by.enum';
import { Gender } from '../../enum/gender.enum';

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
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getRawOne: jest.fn(),
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({}),
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

      const result = await repository.getScenarioVoices('', '', '', {
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
      expect(queryBuilder.offset).not.toHaveBeenCalled();
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

      const result = await repository.getScenarioVoices('', '', '', {
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

      await repository.getScenarioVoices('', '', '', {
        limit: 20,
        offset: 40,
      });

      expect(queryBuilder.offset).toHaveBeenCalledWith(40);
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
    });

    it('should handle empty result set', async () => {
      const mockVoices: ScenarioVoices[] = [];

      queryBuilder.getMany.mockResolvedValue(mockVoices);

      const result = await repository.getScenarioVoices('', '', '', {
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
          languageId: 1,
          active: true,
        } as ScenarioVoices,
      ];

      queryBuilder.getMany.mockResolvedValue(mockVoices as any);

      await repository.getScenarioVoices('', '', '', {
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

      await repository.getScenarioVoices('', '', '', {
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

    it('should not apply limit when not provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.getScenarioVoices('', '', '', {
        offset: 0,
      } as any);

      expect(queryBuilder.limit).not.toHaveBeenCalled();
      expect(queryBuilder.offset).not.toHaveBeenCalled();
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply offset even when value is 0', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.getScenarioVoices('', '', '', {
        limit: 10,
        offset: 0,
      } as any);

      expect(queryBuilder.offset).not.toHaveBeenCalled();
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should not apply offset when not provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await repository.getScenarioVoices('', '', '', {
        limit: 10,
      } as any);

      expect(queryBuilder.offset).not.toHaveBeenCalled();
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('getLanguagesWithVoices', () => {
    it('should return all active languages when voicesNeeded is not true (e.g. Create Voice dropdown)', async () => {
      const mockRows = [
        {
          language_id: '1',
          value: 'en',
          label: 'English',
          voices: JSON.stringify([]),
        },
        {
          language_id: '2',
          value: 'en-US',
          label: 'English Global',
          voices: JSON.stringify([]),
        },
      ];

      queryBuilder.getRawMany.mockResolvedValue(mockRows as any);

      const result = await repository.getLanguagesWithVoices();

      expect(queryBuilder.select).toHaveBeenCalledWith('la.id', 'language_id');
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        `'[]'::jsonb`,
        'voices',
      );
      expect(queryBuilder.from).toHaveBeenCalledWith('languages', 'la');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'scenario_voices',
        'sv',
        'la.id = sv.languageId',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('la.active = true');
      expect(queryBuilder.groupBy).toHaveBeenCalledWith(
        'la.id, la.value, la.label',
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        language_id: 1,
        value: 'en',
        label: 'English',
        voices: [],
      });
      expect(result[1].label).toBe('English Global');
    });

    it('should return languages with voices and voices detail when voicesNeeded is true', async () => {
      const mockRows = [
        {
          language_id: 1,
          value: 'es',
          label: 'Spanish',
          voices: [{ id: 'v2' }],
        },
      ];

      queryBuilder.getRawMany.mockResolvedValue(mockRows as any);

      const result = await repository.getLanguagesWithVoices(false, true);

      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        `jsonb_agg(DISTINCT jsonb_build_object('id', sv.id, 'name', sv.name, 'provider',sv.provider))`,
        'voices',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('la.active = :active', {
        active: false,
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sv.active = :active',
        { active: false },
      );

      expect(result).toEqual([
        {
          language_id: 1,
          value: 'es',
          label: 'Spanish',
          voices: [{ id: 'v2' }],
        },
      ]);
    });

    it('should return empty array if no rows are found', async () => {
      queryBuilder.getRawMany.mockResolvedValue(null as any);

      const result = await repository.getLanguagesWithVoices();

      expect(result).toEqual([]);
    });
  });

  describe('getLanguagesForScenario', () => {
    it('should return languages for scenario with default active=true when no params are provided', async () => {
      const mockRows = [
        {
          language_id: 1,
          value: 'en',
          label: 'English',
          active: true,
          translationCode: 'en-US',
        },
      ];
      queryBuilder.getRawMany.mockResolvedValue(mockRows as any);

      const result = await repository.getLanguagesForScenario();

      expect(queryBuilder.select).toHaveBeenCalledWith(
        'CAST(la.id AS INTEGER)',
        'language_id',
      );
      expect(queryBuilder.from).toHaveBeenCalledWith('languages', 'la');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'scenario_voices',
        'sv',
        'sv.languageId = la.id',
      );
      expect(queryBuilder.groupBy).toHaveBeenCalledWith(
        'la.id, la.value, la.label',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('la.active = true');
      expect(result).toEqual(mockRows);
    });

    it('should apply active filter when active is provided', async () => {
      const mockRows: any[] = [];
      queryBuilder.getRawMany.mockResolvedValue(mockRows);

      await repository.getLanguagesForScenario(false);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'la.active = :active',
        { active: false },
      );
    });

    it('should apply hasVoices filter and having clause when hasVoices is true', async () => {
      const mockRows: any[] = [];
      queryBuilder.getRawMany.mockResolvedValue(mockRows);

      await repository.getLanguagesForScenario(undefined, true);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        `sv.config->>'gender' IN ('male', 'female')`,
      );
      expect(queryBuilder.having).toHaveBeenCalledWith(
        `COUNT(DISTINCT LOWER(sv.config->>'gender')) = 2`,
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('la.active = true');
    });
  });

  describe('getFallbackVoice', () => {
    it('should return fallback voice for male/female gender', async () => {
      const mockVoice = {
        id: 'voice-male',
        name: 'Male Voice',
        languageId: 1,
        config: { gender: Gender.MALE },
      };

      jest.spyOn(repository, 'findOne').mockResolvedValue(mockVoice as any);

      const result = await repository.getFallbackVoice(1, Gender.MALE);

      expect(result).toEqual(mockVoice);
      expect(repository.findOne).toHaveBeenCalledWith({
        select: ['id', 'name', 'config'],
        where: {
          languageId: 1,
          config: expect.any(Object), // Raw matcher
        },
      });
    });

    it('should return fallback voice for non-binary gender without config filter', async () => {
      const mockVoice = {
        id: 'voice-nb',
        name: 'Non-Binary Voice',
        languageId: 1,
        config: {},
      };

      jest.spyOn(repository, 'findOne').mockResolvedValue(mockVoice as any);

      const result = await repository.getFallbackVoice(1, Gender.NON_BINARY);

      expect(result).toEqual(mockVoice);
      expect(repository.findOne).toHaveBeenCalledWith({
        select: ['id', 'name', 'config'],
        where: {
          languageId: 1,
        },
      });
    });
  });
});
