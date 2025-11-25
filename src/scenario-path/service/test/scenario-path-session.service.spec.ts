import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioPathSessionService } from '../scenario-path-session.service';
import { ScenarioPathSessionRepository } from '../../repository/scenario-path-session.repository';
import { ScenarioPathSharedService } from '../scenario-path-shared.service';
import { ScenarioPathSession } from '../../entity/scenario-path-session.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioPathSessionItemRepository } from '../../repository/scenario-path-session-item.repository';
import { ScenarioPathSessionItem } from '../../entity/scenario-path-session-item.entity';
import { SessionItemStatus } from '../../type/scenario-path-session-items.type';

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
  };

  const mockScenarioPathSharedService = {
    getScenarioPathsWithSession: jest.fn(),
    getScenarioPathWithScenarios: jest.fn(),
  };

  const mockScenarioPathSessionItemRepository = {
    find: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
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
        {
          provide: ScenarioPathSessionItemRepository,
          useValue: mockScenarioPathSessionItemRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
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
      });
    });
  });

  describe('getScenarioPathSessionByScenarioPathId', () => {
    it('should return scenario path session when found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      const mockSession: ScenarioPathSession = {
        id: 'session-1',
        scenarioPathId: 'path-1',
      } as ScenarioPathSession;

      repository.findOne.mockResolvedValue(mockSession);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('path-1');

      expect(result).toEqual(mockSession);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1', userId: 123 },
      });
    });

    it('should return null when scenario path session not found', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      repository.findOne.mockResolvedValue(null);

      const result =
        await service.getScenarioPathSessionByScenarioPathId('non-existent-id');

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'non-existent-id', userId: 123 },
      });
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
        {
          id: 'item-1',
          scenarioId: 1,
          order: 1,
          title: 'Scenario 1',
        },
        {
          id: 'item-2',
          scenarioId: 2,
          order: 2,
          title: 'Scenario 2',
        },
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
      expect(
        scenarioPathSharedService.getScenarioPathWithScenarios,
      ).toHaveBeenCalledWith('path-1', 'tenant-1');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { scenarioPathId: 'path-1', userId: 123 },
      });
      expect(scenarioPathSessionItemRepository.find).toHaveBeenCalledWith({
        where: { scenarioPathSessionId: 'session-1' },
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
      expect(
        scenarioPathSharedService.getScenarioPathWithScenarios,
      ).toHaveBeenCalledWith('path-1', 'tenant-1');
      expect(scenarioPathSessionItemRepository.find).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('tenant-1');

      await expect(service.getUserScenarioPathItems('path-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(
        scenarioPathSharedService.getScenarioPathWithScenarios,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when tenant is not available', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('123');
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);

      await expect(service.getUserScenarioPathItems('path-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(
        scenarioPathSharedService.getScenarioPathWithScenarios,
      ).not.toHaveBeenCalled();
    });
  });
});
