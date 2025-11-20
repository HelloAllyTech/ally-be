import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathRepository } from '../../repository/scenario-path.repository';
import {
  ScenarioPathsWithSession,
  ScenarioPathWithSessionFilterOptions,
  ScenarioPathStatus,
} from '../../type/scenario-paths.type';
import { ScenarioPath } from '../../entity/scenario-path.entity';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';

describe('ScenarioPathSharedService', () => {
  let service: ScenarioPathSharedService;
  let scenarioPathRepository: jest.Mocked<ScenarioPathRepository>;

  const mockScenarioPathRepository = {
    getAllScenarioPathsWithSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathSharedService,
        {
          provide: ScenarioPathRepository,
          useValue: mockScenarioPathRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSharedService>(ScenarioPathSharedService);
    scenarioPathRepository = module.get(ScenarioPathRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioPathsWithSession', () => {
    it('should return scenario paths with sessions', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
        limit: 10,
        offset: 0,
      };

      const mockResult: ScenarioPathsWithSession = {
        data: [
          {
            id: 'path-1',
            title: 'Path 1',
            description: 'Description 1',
            coverImageUrl: 'https://example.com/image1.jpg',
            status: ScenarioPathStatus.ACTIVE,
            isGlobal: false,
            totalScenarios: 5,
            createdAt: new Date(),
            updatedAt: new Date(),
            session: {
              id: 'session-1',
              scenarioPathId: 'path-1',
              userId: 123,
              completedScenarios: 2,
              startedAt: new Date(),
              completedAt: undefined,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as ScenarioPathSession,
          } as ScenarioPath & { session: ScenarioPathSession },
        ],
        count: 1,
      };

      scenarioPathRepository.getAllScenarioPathsWithSession.mockResolvedValue(
        mockResult,
      );

      const result = await service.getScenarioPathsWithSession(filters);

      expect(result).toEqual(mockResult);
      expect(
        scenarioPathRepository.getAllScenarioPathsWithSession,
      ).toHaveBeenCalledWith(filters);
    });

    it('should return empty array when no scenario paths found', async () => {
      const filters: ScenarioPathWithSessionFilterOptions = {
        userId: 123,
      };

      const emptyResult: ScenarioPathsWithSession = {
        data: [],
        count: 0,
      };

      scenarioPathRepository.getAllScenarioPathsWithSession.mockResolvedValue(
        emptyResult,
      );

      const result = await service.getScenarioPathsWithSession(filters);

      expect(result).toEqual(emptyResult);
      expect(
        scenarioPathRepository.getAllScenarioPathsWithSession,
      ).toHaveBeenCalledWith(filters);
    });
  });
});
