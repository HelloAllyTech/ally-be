import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenarioSessionRepository } from '../../repository/scenario-session.repository';
import { ScenarioPathItemRepository } from 'src/scenario-path/repository/scenario-path-item.repository';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioPathItem } from 'src/scenario-path/entity/scenario-path-item.entity';
import { ScenarioStatus } from '../../enum/scenario.status.enum';

describe('ScenarioSharedService', () => {
  let service: ScenarioSharedService;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let scenarioSessionRepository: jest.Mocked<ScenarioSessionRepository>;
  let scenarioPathItemRepository: jest.Mocked<ScenarioPathItemRepository>;

  const mockScenarios: Scenarios[] = [
    { id: 1, title: 'Scenario 1', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 2, title: 'Scenario 2', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 3, title: 'Scenario 3', status: ScenarioStatus.ACTIVE } as Scenarios,
  ];

  const mockScenarioSession: ScenarioSessions = {
    id: 'session-1',
    scenarioId: 1,
    counselorId: 123,
  } as ScenarioSessions;

  const mockScenarioPathItem: ScenarioPathItem = {
    id: 'path-item-1',
    scenarioId: 1,
    scenarioPathId: 'path-1',
    order: 1,
  } as ScenarioPathItem;

  beforeEach(async () => {
    const mockScenariosRepository = {
      findBy: jest.fn(),
    };

    const mockScenarioSessionRepository = {
      findOne: jest.fn(),
    };

    const mockScenarioPathItemRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSharedService,
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepository,
        },
        {
          provide: ScenarioSessionRepository,
          useValue: mockScenarioSessionRepository,
        },
        {
          provide: ScenarioPathItemRepository,
          useValue: mockScenarioPathItemRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioSharedService>(ScenarioSharedService);
    scenariosRepository = module.get(ScenariosRepository);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioPathItemRepository = module.get(ScenarioPathItemRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioByIds', () => {
    it('should return scenarios when IDs exist', async () => {
      const scenarioIds = [1, 2, 3];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should return scenarios filtered by status', async () => {
      const scenarioIds = [1, 2];
      const filteredScenarios = mockScenarios.slice(0, 2);
      scenariosRepository.findBy.mockResolvedValue(filteredScenarios);

      const result = await service.getScenarioByIds(scenarioIds, {
        status: ScenarioStatus.ACTIVE,
      });

      expect(result).toEqual(filteredScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
        status: In([ScenarioStatus.ACTIVE]),
      });
    });

    it('should return empty array when no scenarios found', async () => {
      const scenarioIds = [999];
      scenariosRepository.findBy.mockResolvedValue([]);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual([]);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should not include status filter when not provided', async () => {
      const scenarioIds = [1, 2];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      await service.getScenarioByIds(scenarioIds);

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

      const result = await service.getScenarioSessionById('non-existent');

      expect(result).toBeNull();
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
      });
    });
  });

  describe('getScenarioPathItemByScenarioId', () => {
    it('should return scenario path item when found', async () => {
      scenarioPathItemRepository.findOne.mockResolvedValue(
        mockScenarioPathItem,
      );

      const result = await service.getScenarioPathItemByScenarioId(1);

      expect(result).toEqual(mockScenarioPathItem);
      expect(scenarioPathItemRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioId: 1 },
      });
    });

    it('should return null when scenario path item not found', async () => {
      scenarioPathItemRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioPathItemByScenarioId(999);

      expect(result).toBeNull();
      expect(scenarioPathItemRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioId: 999 },
      });
    });

    it('should check if scenario is part of a path', async () => {
      scenarioPathItemRepository.findOne.mockResolvedValue(
        mockScenarioPathItem,
      );

      const result = await service.getScenarioPathItemByScenarioId(1);

      expect(result).toBeTruthy();
      expect(result?.scenarioId).toBe(1);
    });
  });
});
