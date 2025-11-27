import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioPathSessionService } from '../scenario-path-session.service';
import { ScenarioPathSessionRepository } from '../../repository/scenario-path-session.repository';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioPathSessionItemRepository } from '../../repository/scenario-path-session-item.repository';
import { ScenarioPathSessionItem } from '../../entity/scenario-path-session-item.entity';
import { SessionItemStatus } from '../../type/scenario-path-session-items.type';
import { ScenarioPathStatus } from '../../type/scenario-paths.type';
import { AppConfigService } from 'src/config/config.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
  },
}));

describe('ScenarioPathSessionService', () => {
  let service: ScenarioPathSessionService;
  let repository: jest.Mocked<ScenarioPathSessionRepository>;
  let scenarioPathSharedService: jest.Mocked<ScenarioPathSharedService>;
  let scenarioPathSessionItemRepository: jest.Mocked<ScenarioPathSessionItemRepository>;

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockScenarioPathSharedService = {
    getScenarioPathsWithSession: jest.fn(),
    getScenarioPathWithScenarios: jest.fn(),
    getScenarioPathItems: jest.fn(),
    getScenarioSessionById: jest.fn(),
    getScenarioPathItemById: jest.fn(),
    getNextScenarioDataByPathItemId: jest.fn(),
    getNextPathItemByCurrentItemId: jest.fn(),
    getScenarioDataById: jest.fn(),
  };

  const mockScenarioPathSessionItemRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  const mockConfigService = {
    simulationPath: {
      simulationPathItemMinDurationForCompletion: 0,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioPathSessionService,
        { provide: ScenarioPathSessionRepository, useValue: mockRepository },
        {
          provide: ScenarioPathSharedService,
          useValue: mockScenarioPathSharedService,
        },
        {
          provide: ScenarioPathSessionItemRepository,
          useValue: mockScenarioPathSessionItemRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ScenarioPathSessionService>(
      ScenarioPathSessionService,
    );
    repository = module.get(ScenarioPathSessionRepository);
    scenarioPathSharedService = module.get(ScenarioPathSharedService);
    scenarioPathSessionItemRepository = module.get(
      ScenarioPathSessionItemRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(undefined);
  });

  describe('getUserScenarioPaths', () => {
    const mockScenarioPathsWithSession = {
      data: [
        {
          id: 'path-1',
          title: 'Path 1',
          description: 'Description 1',
          coverImageUrl: 'https://example.com/image.jpg',
          totalScenarios: 5,
          session: { completedScenarios: 2 },
        },
        {
          id: 'path-2',
          title: 'Path 2',
          description: 'Description 2',
          totalScenarios: 3,
          session: { completedScenarios: 1 },
        },
      ] as any,
      count: 2,
    };

    it('should return formatted scenario path sessions when user and tenant are authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      scenarioPathSharedService.getScenarioPathsWithSession.mockResolvedValue(
        mockScenarioPathsWithSession,
      );

      const result = await service.getUserScenarioPaths({
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
        tenantId: 'tenant-1',
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
        status: ScenarioPathStatus.ACTIVE,
      });
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');

      await expect(
        service.getUserScenarioPaths({ offset: 0, limit: 10 }),
      ).rejects.toThrow(UnauthorizedException);
      expect(
        scenarioPathSharedService.getScenarioPathsWithSession,
      ).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when tenant is not available', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);

      await expect(
        service.getUserScenarioPaths({ offset: 0, limit: 10 }),
      ).rejects.toThrow(UnauthorizedException);
      expect(
        scenarioPathSharedService.getScenarioPathsWithSession,
      ).not.toHaveBeenCalled();
    });

    it('should handle scenario paths without sessions', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
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

      const result = await service.getUserScenarioPaths();

      expect(result.data[0].completedScenarios).toBeUndefined();
    });

    it('should call service with correct parameters when no filters provided', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      scenarioPathSharedService.getScenarioPathsWithSession.mockResolvedValue(
        mockScenarioPathsWithSession,
      );

      await service.getUserScenarioPaths();

      expect(
        scenarioPathSharedService.getScenarioPathsWithSession,
      ).toHaveBeenCalledWith({
        userId: 123,
        tenantId: 'tenant-1',
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: undefined,
        status: ScenarioPathStatus.ACTIVE,
      });
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
    });
  });

  describe('getUserScenarioPathSessionByScenarioPathId', () => {
    it('should return scenario path session when found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const mockSession: ScenarioPathSession = {
        id: 'session-1',
        scenarioPathId: 'path-1',
      } as ScenarioPathSession;

      repository.findOne.mockResolvedValue(mockSession);

      const result =
        await service.getUserScenarioPathSessionByScenarioPathId('path-1');

      expect(result).toEqual(mockSession);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1', userId: 123 },
      });
    });

    it('should return null when scenario path session not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      repository.findOne.mockResolvedValue(null);

      const result =
        await service.getUserScenarioPathSessionByScenarioPathId(
          'non-existent-id',
        );

      expect(result).toBeNull();
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(
        service.getUserScenarioPathSessionByScenarioPathId('path-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getUserScenarioPathItems', () => {
    const mockScenarioPathWithScenarios = {
      id: 'path-1',
      title: 'Path 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/image.jpg',
      status: 'ACTIVE' as any,
      isGlobal: false,
      totalScenarios: 2,
      scenarios: [
        { id: 'item-1', scenarioId: 1, order: 1, title: 'Scenario 1' },
        { id: 'item-2', scenarioId: 2, order: 2, title: 'Scenario 2' },
      ],
    };

    const mockScenarioPathSession: ScenarioPathSession = {
      id: 'session-1',
      scenarioPathId: 'path-1',
      userId: 123,
      completedScenarios: 1,
      completedAt: new Date(),
    } as ScenarioPathSession;

    const mockSessionItems: ScenarioPathSessionItem[] = [
      {
        id: 'session-item-1',
        scenarioPathSessionId: 'session-1',
        scenarioPathItemId: 'item-1',
        userId: 123,
        status: SessionItemStatus.COMPLETED,
      } as ScenarioPathSessionItem,
    ];

    it('should return scenario path items with session data when session exists', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      scenarioPathSharedService.getScenarioPathWithScenarios.mockResolvedValue(
        mockScenarioPathWithScenarios,
      );
      repository.findOne.mockResolvedValue(mockScenarioPathSession);
      scenarioPathSessionItemRepository.find.mockResolvedValue(
        mockSessionItems,
      );

      const result = await service.getUserScenarioPathItems('path-1');

      expect(result).toEqual({
        ...mockScenarioPathWithScenarios,
        completedScenarios: 1,
        completedAt: mockScenarioPathSession.completedAt,
        scenarioPathSessionId: 'session-1',
        scenarios: [
          {
            ...mockScenarioPathWithScenarios.scenarios[0],
            sessionId: 'session-item-1',
            status: SessionItemStatus.COMPLETED,
          },
          {
            ...mockScenarioPathWithScenarios.scenarios[1],
            sessionId: undefined,
            status: SessionItemStatus.LOCKED,
          },
        ],
      });
    });

    it('should return scenario path items without session when session does not exist', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');
      scenarioPathSharedService.getScenarioPathWithScenarios.mockResolvedValue(
        mockScenarioPathWithScenarios,
      );
      repository.findOne.mockResolvedValue(null);

      const result = await service.getUserScenarioPathItems('path-1');

      expect(result).toEqual({
        ...mockScenarioPathWithScenarios,
        completedScenarios: 0,
        completedAt: null,
        scenarioPathSessionId: null,
        scenarios: [
          {
            ...mockScenarioPathWithScenarios.scenarios[0],
            sessionId: null,
            status: SessionItemStatus.UNLOCKED,
          },
          {
            ...mockScenarioPathWithScenarios.scenarios[1],
            sessionId: null,
            status: SessionItemStatus.LOCKED,
          },
        ],
      });
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');

      await expect(service.getUserScenarioPathItems('path-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw NotFoundException when tenant is not available', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);

      await expect(service.getUserScenarioPathItems('path-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createUserPathSession', () => {
    it('should create a new path session successfully', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      repository.findOne.mockResolvedValue(null);
      scenarioPathSharedService.getScenarioPathItems.mockResolvedValue([
        { id: 'item-1', order: 1 },
        { id: 'item-2', order: 2 },
      ] as any);

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === ScenarioPathSession) {
            return {
              create: jest.fn().mockReturnValue({ id: 'session-1' }),
              save: jest.fn().mockResolvedValue({ id: 'session-1' }),
            };
          }
          if (entity === ScenarioPathSessionItem) {
            return {
              create: jest.fn().mockReturnValue({ id: 'session-item-1' }),
              save: jest.fn().mockResolvedValue({ id: 'session-item-1' }),
            };
          }
        }),
      };

      mockDataSource.transaction.mockImplementation(async (callback) =>
        callback(mockEntityManager as any),
      );

      const result = await service.createUserPathSession('path-1');

      expect(result).toEqual({ scenarioPathSessionItemId: 'session-item-1' });
    });

    it('should throw BadRequestException if session already exists', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      repository.findOne.mockResolvedValue({ id: 'existing-session' } as any);

      await expect(service.createUserPathSession('path-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(service.createUserPathSession('path-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw BadRequestException when no scenario path items available', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      repository.findOne.mockResolvedValue(null);
      scenarioPathSharedService.getScenarioPathItems.mockResolvedValue([]);

      const mockEntityManager = {
        getRepository: jest.fn(() => ({
          create: jest.fn().mockReturnValue({ id: 'session-1' }),
          save: jest.fn().mockResolvedValue({ id: 'session-1' }),
        })),
      };

      mockDataSource.transaction.mockImplementation(async (callback) =>
        callback(mockEntityManager as any),
      );

      await expect(service.createUserPathSession('path-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getNextScenarioPathItem', () => {
    const mockCurrentScenarioSession = {
      id: 'scenario-session-1',
      roomId: 'room-1',
      scenarioId: 'scenario-1',
      counselorId: 123,
      userId: 123,
      scenarioPathSessionItemId: 'session-item-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const mockCurrentPathSessionItem = {
      id: 'session-item-1',
      scenarioPathItemId: 'path-item-1',
      status: SessionItemStatus.COMPLETED,
    };

    const mockCurrentPathItem = {
      scenarioId: 'scenario-1',
      scenarioPathId: 'path-1',
      messageTitle: 'Great job!',
      messageContent: 'You completed the scenario',
    };

    const mockCurrentScenarioData = {
      id: 'scenario-1',
      title: 'Scenario 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/cover.jpg',
      coverVideoUrl: 'https://example.com/video.mp4',
    };

    it('should return current session data when session item is not completed', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      scenarioPathSharedService.getScenarioSessionById.mockResolvedValue(
        mockCurrentScenarioSession,
      );
      scenarioPathSessionItemRepository.findOne.mockResolvedValue({
        ...mockCurrentPathSessionItem,
        status: SessionItemStatus.UNLOCKED,
      } as any);
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockCurrentPathItem as any,
      );
      scenarioPathSharedService.getScenarioDataById.mockResolvedValue(
        mockCurrentScenarioData as any,
      );
      repository.findOne.mockResolvedValue({
        completedAt: null,
      } as any);

      const result =
        await service.getNextScenarioPathItem('scenario-session-1');

      expect(result).toEqual({
        currentSession: {
          scenarioId: 'scenario-1',
          title: 'Scenario 1',
          description: 'Description 1',
          coverImageUrl: 'https://example.com/cover.jpg',
          coverVideoUrl: 'https://example.com/video.mp4',
          scenarioPathSessionItemStatus: SessionItemStatus.UNLOCKED,
          scenarioPathSessionItemId: 'session-item-1',
          transitionMessageTitle: 'Great job!',
          transitionMessageContent: 'You completed the scenario',
          isScenarioPathSessionCompleted: false,
        },
      });
    });

    it('should return both current and upcoming scenario when current is completed', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      scenarioPathSharedService.getScenarioSessionById.mockResolvedValue(
        mockCurrentScenarioSession,
      );
      scenarioPathSessionItemRepository.findOne
        .mockResolvedValueOnce(mockCurrentPathSessionItem as any)
        .mockResolvedValueOnce({
          id: 'session-item-2',
          status: SessionItemStatus.UNLOCKED,
        } as any);
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockCurrentPathItem as any,
      );
      scenarioPathSharedService.getScenarioDataById.mockResolvedValue(
        mockCurrentScenarioData as any,
      );
      repository.findOne.mockResolvedValue({
        completedAt: null,
      } as any);
      scenarioPathSharedService.getNextScenarioDataByPathItemId.mockResolvedValue(
        {
          scenario: {
            id: 'scenario-2',
            title: 'Scenario 2',
            description: 'Description 2',
            coverImageUrl: 'https://example.com/cover2.jpg',
            coverVideoUrl: 'https://example.com/video2.mp4',
          },
          pathItem: {
            id: 'path-item-2',
            order: 2,
          },
        } as any,
      );

      const result =
        await service.getNextScenarioPathItem('scenario-session-1');

      expect(result?.upcomingScenario).toBeDefined();
      expect(result?.upcomingScenario?.id).toBe('scenario-2');
    });

    it('should return null when scenario session item id not found', async () => {
      scenarioPathSharedService.getScenarioSessionById.mockResolvedValue({
        scenarioPathSessionItemId: null,
      } as any);

      const result =
        await service.getNextScenarioPathItem('scenario-session-1');

      expect(result).toBeNull();
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);
      scenarioPathSharedService.getScenarioSessionById.mockResolvedValue(
        mockCurrentScenarioSession,
      );

      await expect(
        service.getNextScenarioPathItem('scenario-session-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException when path session item not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      scenarioPathSharedService.getScenarioSessionById.mockResolvedValue(
        mockCurrentScenarioSession,
      );
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getNextScenarioPathItem('scenario-session-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleEndScenarioPathSession', () => {
    const mockSessionItem = {
      id: 'session-item-1',
      scenarioPathSessionId: 'session-1',
      scenarioPathItemId: 'path-item-1',
      status: SessionItemStatus.UNLOCKED,
    };

    const mockPathItem = {
      id: 'path-item-1',
      scenarioPathId: 'path-1',
      minimumScore: 70,
    };

    const mockPathSession = {
      id: 'session-1',
      completedScenarios: 0,
    };

    it('should return early if call duration is less than required', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 10;

      const result = await service.handleEndScenarioPathSession({
        scenarioPathSessionItemId: 'session-item-1',
        score: 80,
        callDuration: 5000,
      });

      expect(result).toBeUndefined();
      expect(scenarioPathSessionItemRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return early if score is less than minimum score', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(
        mockSessionItem as any,
      );
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockPathItem as any,
      );

      const result = await service.handleEndScenarioPathSession({
        scenarioPathSessionItemId: 'session-item-1',
        score: 60,
        callDuration: 10000,
      });

      expect(result).toBeUndefined();
    });

    it('should complete session item and create next item when next path item exists', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne
        .mockResolvedValueOnce(mockSessionItem as any)
        .mockResolvedValueOnce(null);
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockPathItem as any,
      );
      repository.findOne.mockResolvedValue(mockPathSession as any);
      scenarioPathSharedService.getNextPathItemByCurrentItemId.mockResolvedValue(
        { id: 'path-item-2' } as any,
      );

      const mockSessionItemRepo = {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockReturnValue({ id: 'session-item-2' }),
        save: jest.fn().mockResolvedValue({ id: 'session-item-2' }),
      };
      const mockSessionRepo = {
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === ScenarioPathSessionItem) return mockSessionItemRepo;
          if (entity === ScenarioPathSession) return mockSessionRepo;
        }),
      };

      mockDataSource.transaction.mockImplementation(async (callback) =>
        callback(mockEntityManager as any),
      );

      await service.handleEndScenarioPathSession({
        scenarioPathSessionItemId: 'session-item-1',
        score: 80,
        callDuration: 10000,
      });

      expect(mockSessionItemRepo.update).toHaveBeenCalledWith(
        'session-item-1',
        {
          status: SessionItemStatus.COMPLETED,
        },
      );
      expect(mockSessionRepo.update).toHaveBeenCalledWith('session-1', {
        completedScenarios: 1,
      });
      expect(mockSessionItemRepo.save).toHaveBeenCalled();
    });

    it('should complete entire path session when no next path item exists', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(
        mockSessionItem as any,
      );
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockPathItem as any,
      );
      repository.findOne.mockResolvedValue(mockPathSession as any);
      scenarioPathSharedService.getNextPathItemByCurrentItemId.mockResolvedValue(
        null,
      );

      const mockSessionItemRepo = {
        update: jest.fn().mockResolvedValue({}),
      };
      const mockSessionRepo = {
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === ScenarioPathSessionItem) return mockSessionItemRepo;
          if (entity === ScenarioPathSession) return mockSessionRepo;
        }),
      };

      mockDataSource.transaction.mockImplementation(async (callback) =>
        callback(mockEntityManager as any),
      );

      await service.handleEndScenarioPathSession({
        scenarioPathSessionItemId: 'session-item-1',
        score: 80,
        callDuration: 10000,
      });

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          completedAt: expect.any(Date),
          completedScenarios: 1,
        }),
      );
    });

    it('should unlock existing locked next session item', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne
        .mockResolvedValueOnce(mockSessionItem as any)
        .mockResolvedValueOnce({
          id: 'session-item-2',
          status: SessionItemStatus.LOCKED,
        } as any);
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockPathItem as any,
      );
      repository.findOne.mockResolvedValue(mockPathSession as any);
      scenarioPathSharedService.getNextPathItemByCurrentItemId.mockResolvedValue(
        { id: 'path-item-2' } as any,
      );

      const mockSessionItemRepo = {
        update: jest.fn().mockResolvedValue({}),
      };
      const mockSessionRepo = {
        update: jest.fn().mockResolvedValue({}),
      };

      const mockEntityManager = {
        getRepository: jest.fn((entity) => {
          if (entity === ScenarioPathSessionItem) return mockSessionItemRepo;
          if (entity === ScenarioPathSession) return mockSessionRepo;
        }),
      };

      mockDataSource.transaction.mockImplementation(async (callback) =>
        callback(mockEntityManager as any),
      );

      await service.handleEndScenarioPathSession({
        scenarioPathSessionItemId: 'session-item-1',
        score: 80,
        callDuration: 10000,
      });

      expect(mockSessionItemRepo.update).toHaveBeenCalledWith(
        'session-item-2',
        {
          status: SessionItemStatus.UNLOCKED,
        },
      );
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      await expect(
        service.handleEndScenarioPathSession({
          scenarioPathSessionItemId: 'session-item-1',
          score: 80,
          callDuration: 10000,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException when session item not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(null);

      await expect(
        service.handleEndScenarioPathSession({
          scenarioPathSessionItemId: 'session-item-1',
          score: 80,
          callDuration: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when path item not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(
        mockSessionItem as any,
      );
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(null);

      await expect(
        service.handleEndScenarioPathSession({
          scenarioPathSessionItemId: 'session-item-1',
          score: 80,
          callDuration: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when path session not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      mockConfigService.simulationPath.simulationPathItemMinDurationForCompletion = 0;
      scenarioPathSessionItemRepository.findOne.mockResolvedValue(
        mockSessionItem as any,
      );
      scenarioPathSharedService.getScenarioPathItemById.mockResolvedValue(
        mockPathItem as any,
      );
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.handleEndScenarioPathSession({
          scenarioPathSessionItemId: 'session-item-1',
          score: 80,
          callDuration: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
