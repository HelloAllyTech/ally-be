import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { ScenarioSessionRepository } from '../../repository/scenario-session.repository';
import { ScenarioPathItemRepository } from 'src/scenario-path/repository/scenario-path-item.repository';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioStatus } from '../../type/scenario.type';
import { ScenarioFilters } from 'src/learn/type/scenario-filter.type';
import { ScenarioTranslationsRepository } from 'src/learn/repository/scenario-translations.repository';
import { ScenarioSessionMessagesRepository } from '../../repository/scenario-session-messages.repository';
import { ScenarioSessionDetailsRepository } from '../../repository/scenario-session-details.repository';

describe('ScenarioSharedService', () => {
  let service: ScenarioSharedService;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let scenarioSessionRepository: jest.Mocked<ScenarioSessionRepository>;
  let scenarioTranslationsRepository: jest.Mocked<ScenarioTranslationsRepository>;

  const mockScenarios: Scenarios[] = [
    { id: 1, title: 'Scenario 1', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 2, title: 'Scenario 2', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 3, title: 'Scenario 3', status: ScenarioStatus.DRAFT } as Scenarios,
  ];

  const mockScenarioSession: ScenarioSessions = {
    id: 'session-1',
    scenarioId: 1,
    counselorId: 123,
  } as ScenarioSessions;

  beforeEach(async () => {
    const mockScenariosRepo = {
      findBy: jest.fn(),
      findOne: jest.fn(),
    };

    const mockScenarioSessionRepo = {
      findOne: jest.fn(),
    };

    const mockScenarioPathItemRepo = {
      findOne: jest.fn(),
    };

    const mockScenarioTranslationsRepository = {
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
    };

    const mockScenarioSessionMessagesRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockScenarioSessionDetailsRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSharedService,
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepo,
        },
        {
          provide: ScenarioSessionRepository,
          useValue: mockScenarioSessionRepo,
        },
        {
          provide: ScenarioPathItemRepository,
          useValue: mockScenarioPathItemRepo,
        },
        {
          provide: ScenarioTranslationsRepository,
          useValue: mockScenarioTranslationsRepository,
        },
        {
          provide: ScenarioSessionMessagesRepository,
          useValue: mockScenarioSessionMessagesRepository,
        },
        {
          provide: ScenarioSessionDetailsRepository,
          useValue: mockScenarioSessionDetailsRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioSharedService>(ScenarioSharedService);
    scenariosRepository = module.get(ScenariosRepository);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioTranslationsRepository = module.get(ScenarioTranslationsRepository);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioByIds', () => {
    it('should return scenarios when IDs exist (no filters)', async () => {
      const scenarioIds = [1, 2, 3];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should apply status filter when provided', async () => {
      const scenarioIds = [1, 2];
      const filters: ScenarioFilters = {
        status: ScenarioStatus.ACTIVE,
      };
      const filteredScenarios = mockScenarios.filter(
        (s) => s.status === ScenarioStatus.ACTIVE,
      );
      scenariosRepository.findBy.mockResolvedValue(filteredScenarios);

      const result = await service.getScenarioByIds(scenarioIds, filters);

      expect(result).toEqual(filteredScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
        status: In([ScenarioStatus.ACTIVE]),
      });
    });

    it('should return empty array when repository returns none', async () => {
      const scenarioIds = [999];
      scenariosRepository.findBy.mockResolvedValue([]);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual([]);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should not include status filter when filters.status is not provided', async () => {
      const scenarioIds = [1, 2];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await service.getScenarioByIds(scenarioIds, {});

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });
  });

  describe('getScenarioSessionById', () => {
    it('should return scenario session when found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      const result = await service.getScenarioSessionById('session-1');

      expect(result).toEqual(mockScenarioSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('should return null when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSessionById('non-existent-id');

      expect(result).toBeNull();
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
    });
  });

  describe('getScenarioById', () => {
    it('should return scenario when found', async () => {
      const mockScenario = mockScenarios[0];
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getScenarioById(1);

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should return null when scenario not found', async () => {
      scenariosRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioById(999);

      expect(result).toBeNull();
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: 999 },
      });
    });
  });

  describe('getUniqueLanguagesFromScenarioTranslations', () => {
    it('should return unique language IDs from scenario translations', async () => {
      // Mock the repository method
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockResolvedValue([1, 2, 3]);

      const result = await service.getUniqueLanguagesFromScenarioTranslations();

      expect(result).toEqual([1, 2, 3]);
      expect(
        scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations,
      ).toHaveBeenCalled();
    });

    it('should return an empty array when no translations exist', async () => {
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockResolvedValue([]);

      const result = await service.getUniqueLanguagesFromScenarioTranslations();

      expect(result).toEqual([]);
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockRejectedValue(error);

      // Option 1: Test that the error is re-thrown
      await expect(
        service.getUniqueLanguagesFromScenarioTranslations(),
      ).rejects.toThrow('Database error');
    });
  });
});
