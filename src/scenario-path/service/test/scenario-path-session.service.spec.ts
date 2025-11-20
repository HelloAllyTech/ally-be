import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ScenarioPathSessionService } from '../scenario-path-session.service';
import { ScenarioPathSessionRepository } from '../../repository/scenario-path-session.repository';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
  },
}));

describe('ScenarioPathSessionService', () => {
  let service: ScenarioPathSessionService;
  let repository: jest.Mocked<ScenarioPathSessionRepository>;
  let scenarioPathSharedService: jest.Mocked<ScenarioPathSharedService>;

  const mockRepository = {
    findOne: jest.fn(),
  };

  const mockScenarioPathSharedService = {
    getScenarioPathsWithSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathSessionService,
        {
          provide: ScenarioPathSessionRepository,
          useValue: mockRepository,
        },
        {
          provide: ScenarioPathSharedService,
          useValue: mockScenarioPathSharedService,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSessionService>(
      ScenarioPathSessionService,
    );
    repository = module.get(ScenarioPathSessionRepository);
    scenarioPathSharedService = module.get(ScenarioPathSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);
  });

  describe('getScenarioPathSessions', () => {
    const mockScenarioPathsWithSession = {
      data: [
        {
          id: 'path-1',
          title: 'Path 1',
          description: 'Description 1',
          coverImageUrl: 'https://example.com/image.jpg',
          totalScenarios: 5,
          session: {
            completedScenarios: 2,
          },
        },
        {
          id: 'path-2',
          title: 'Path 2',
          description: 'Description 2',
          totalScenarios: 3,
          session: {
            completedScenarios: 1,
          },
        },
      ] as any,
      count: 2,
    };

    it('should return formatted scenario path sessions when user is authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      scenarioPathSharedService.getScenarioPathsWithSession.mockResolvedValue(
        mockScenarioPathsWithSession,
      );

      const result = await service.getScenarioPathSessions({
        offset: 0,
        limit: 10,
      });

      expect(result).toEqual({
        data: [
          {
            id: 'path-1',
            title: 'Path 1',
            description: 'Description 1',
            coverImageUrl: 'https://example.com/image.jpg',
            totalScenarios: 5,
            completedScenarios: 2,
          },
          {
            id: 'path-2',
            title: 'Path 2',
            description: 'Description 2',
            totalScenarios: 3,
            completedScenarios: 1,
          },
        ],
        count: 2,
      });
      expect(
        scenarioPathSharedService.getScenarioPathsWithSession,
      ).toHaveBeenCalledWith({
        userId: 123,
        limit: 10,
        offset: 0,
      });
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(
        service.getScenarioPathSessions({ offset: 0, limit: 10 }),
      ).rejects.toThrow(UnauthorizedException);
      expect(
        scenarioPathSharedService.getScenarioPathsWithSession,
      ).not.toHaveBeenCalled();
    });

    it('should handle scenario paths without sessions', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      scenarioPathSharedService.getScenarioPathsWithSession.mockResolvedValue({
        data: [
          {
            id: 'path-1',
            title: 'Path 1',
            totalScenarios: 5,
            status: 'ACTIVE' as any,
            isGlobal: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            session: null as any,
          },
        ],
        count: 1,
      } as any);

      const result = await service.getScenarioPathSessions();

      expect(result.data[0].completedScenarios).toBeUndefined();
    });
  });

  describe('getScenarioPathSessionByScenarioPathId', () => {
    it('should return scenario path session when found', async () => {
      const mockSession: ScenarioPathSession = {
        id: 'session-1',
        scenarioPathId: 'path-1',
      } as ScenarioPathSession;

      repository.findOne.mockResolvedValue(mockSession);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('path-1');

      expect(result).toEqual(mockSession);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1' },
      });
    });

    it('should return null when scenario path session not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('non-existent-id');

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'non-existent-id' },
      });
    });
  });
});
