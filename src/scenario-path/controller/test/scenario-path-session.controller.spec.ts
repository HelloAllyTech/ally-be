import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioPathSessionController } from '../scenario-path-session.controller';
import { ScenarioPathSessionService } from '../../service/scenario-path-session.service';
import { ScenarioPathSessionsResponseDto } from '../../dto/scenario-path-sessions.dto';
import { ScenarioPathSharedService } from '../../service/scenario-path-shared.service';
import { ScenarioPathSessionItem } from '../../entity/scenario-path-session-item.entity';
import { ScenarioPathItem } from '../../entity/scenario-path-item.entity';
import { SessionItemStatus } from '../../type/scenario-path-session-items.type';
import { ScenarioPathSessionSortBy } from '../../type/scenario-path-session-items.type';
import { SortOrder } from '../../type/scenario-paths.type';

jest.mock('../../../auth/decorators/auth-permissions.decorator', () => ({
  AuthPermissions: () => () => {},
}));

describe('ScenarioPathSessionController', () => {
  let controller: ScenarioPathSessionController;
  let service: jest.Mocked<ScenarioPathSessionService>;

  const mockScenarioPathSessionService = {
    getUserScenarioPaths: jest.fn(),
    getUserScenarioPathItems: jest.fn(),
    getNextScenarioPathItem: jest.fn(),
  };

  const mockScenarioPathSharedService = {
    getNextScenarioPathItem: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioPathSessionController],
      providers: [
        {
          provide: ScenarioPathSessionService,
          useValue: mockScenarioPathSessionService,
        },
        {
          provide: ScenarioPathSharedService,
          useValue: mockScenarioPathSharedService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioPathSessionController>(
      ScenarioPathSessionController,
    );
    service = module.get(ScenarioPathSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioPathSessions', () => {
    const mockResponse: ScenarioPathSessionsResponseDto = {
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
    };

    it('should return scenario path sessions without query parameters', async () => {
      service.getUserScenarioPaths.mockResolvedValue(mockResponse);

      const result = await controller.getUserScenarioPaths();

      expect(result).toEqual(mockResponse);
      expect(service.getUserScenarioPaths).toHaveBeenCalledWith({
        offset: undefined,
        limit: undefined,
        sortBy: ScenarioPathSessionSortBy.UPDATED_AT,
        order: SortOrder.DESC,
      });
    });

    it('should return scenario path sessions with query parameters', async () => {
      service.getUserScenarioPaths.mockResolvedValue(mockResponse);

      const result = await controller.getUserScenarioPaths(10, 20);

      expect(result).toEqual(mockResponse);
      expect(service.getUserScenarioPaths).toHaveBeenCalledWith({
        offset: 10,
        limit: 20,
        sortBy: ScenarioPathSessionSortBy.UPDATED_AT,
        order: SortOrder.DESC,
      });
    });
  });

  describe('getUserScenarioPathItems', () => {
    const mockResponse = {
      id: 'path-1',
      title: 'Path 1',
      description: 'Description 1',
      coverImageUrl: 'https://example.com/image.jpg',
      status: 'ACTIVE' as any,
      isGlobal: false,
      totalScenarios: 1,
      completedScenarios: 2,
      completedAt: new Date(),
      scenarioPathSessionId: 'session-1',
      scenarios: [
        {
          id: 'item-1',
          scenarioId: 1,
          order: 1,
          messageTitle: 'Message Title',
          messageContent: 'Message Content',
          minimumScore: 0,
          title: 'Scenario 1',
          description: 'Scenario Description',
          coverImageUrl: 'https://example.com/scenario.jpg',
          coverVideoUrl: 'https://example.com/scenario.mp4',
          sessionId: 'session-item-1',
          status: 'COMPLETED' as any,
        },
      ],
    };

    it('should return scenario path items by id', async () => {
      service.getUserScenarioPathItems.mockResolvedValue(mockResponse);

      const result = await controller.getUserScenarioPathItems('path-1');

      expect(result).toEqual(mockResponse);
      expect(service.getUserScenarioPathItems).toHaveBeenCalledWith('path-1');
    });
  });

  describe('getUpcomingScenarioPathItem', () => {
    const scenarioSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const mockScenario = {
      id: 1,
      title: 'Customer Service Scenario',
      scenario: 'You are a customer service representative...',
      description: 'Practice handling customer complaints',
      coverImageUrl: 'https://example.com/scenario-cover.jpg',
      coverVideoUrl: 'https://example.com/scenario-cover.mp4',
      status: 'ACTIVE' as any,
      prompt: 'You are a helpful customer service agent',
      metadata: {},
      createdBy: 123,
      updatedBy: 123,
      isGlobal: false,
      createdAt: new Date('2024-01-15T10:00:00Z'),
      updatedAt: new Date('2024-01-15T10:00:00Z'),
    };

    it('should return upcoming scenario path item when all data is present', async () => {
      const mockNextScenarioPathItem = {
        nextScenarioSessionItem: {
          id: 'session-item-123',
          scenarioPathSessionId: 'session-123',
          userId: 123,
          scenarioPathItemId: 'path-item-123',
          status: SessionItemStatus.UNLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathSessionItem,
        nextScenarioData: {
          scenario: mockScenario,
          pathItem: {
            id: 'path-item-123',
            scenarioPathId: 'path-123',
            scenarioId: 1,
            order: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ScenarioPathItem,
        },
        currentPathItem: {
          id: 'current-path-item-123',
          scenarioPathId: 'path-123',
          scenarioId: 1,
          order: 1,
          messageTitle: 'Great job on the previous scenario!',
          messageContent:
            "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathItem,
      };

      service.getNextScenarioPathItem.mockResolvedValue(
        mockNextScenarioPathItem as any,
      );

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toEqual({
        ...mockScenario,
        order: 2,
        scenarioPathSessionItemId: 'session-item-123',
        transitionMessageTitle: 'Great job on the previous scenario!',
        transitionMessageContent:
          "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
      });
      expect(service.getNextScenarioPathItem).toHaveBeenCalledWith(
        scenarioSessionId,
      );
      expect(service.getNextScenarioPathItem).toHaveBeenCalledTimes(1);
    });

    it('should return null when nextScenarioData.scenario is missing', async () => {
      const mockNextScenarioPathItem = {
        nextScenarioSessionItem: {
          id: 'session-item-123',
          scenarioPathSessionId: 'session-123',
          userId: 123,
          scenarioPathItemId: 'path-item-123',
          status: SessionItemStatus.UNLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathSessionItem,
        nextScenarioData: {
          scenario: null,
          pathItem: {
            id: 'path-item-123',
            scenarioPathId: 'path-123',
            scenarioId: 1,
            order: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ScenarioPathItem,
        },
        currentPathItem: {
          id: 'current-path-item-123',
          scenarioPathId: 'path-123',
          scenarioId: 1,
          order: 1,
          messageTitle: 'Great job!',
          messageContent: 'Well done!',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathItem,
      };

      service.getNextScenarioPathItem.mockResolvedValue(
        mockNextScenarioPathItem as any,
      );

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toBeNull();
      expect(service.getNextScenarioPathItem).toHaveBeenCalledWith(
        scenarioSessionId,
      );
    });

    it('should return null when nextScenarioData is missing', async () => {
      const mockNextScenarioPathItem = {
        nextScenarioSessionItem: {
          id: 'session-item-123',
          scenarioPathSessionId: 'session-123',
          userId: 123,
          scenarioPathItemId: 'path-item-123',
          status: SessionItemStatus.UNLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathSessionItem,
        nextScenarioData: undefined,
        currentPathItem: {
          id: 'current-path-item-123',
          scenarioPathId: 'path-123',
          scenarioId: 1,
          order: 1,
          messageTitle: 'Great job!',
          messageContent: 'Well done!',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathItem,
      };

      service.getNextScenarioPathItem.mockResolvedValue(
        mockNextScenarioPathItem as any,
      );

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toBeNull();
      expect(service.getNextScenarioPathItem).toHaveBeenCalledWith(
        scenarioSessionId,
      );
    });

    it('should return null when currentPathItem is missing', async () => {
      const mockNextScenarioPathItem = {
        nextScenarioSessionItem: {
          id: 'session-item-123',
          scenarioPathSessionId: 'session-123',
          userId: 123,
          scenarioPathItemId: 'path-item-123',
          status: SessionItemStatus.UNLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathSessionItem,
        nextScenarioData: {
          scenario: mockScenario,
          pathItem: {
            id: 'path-item-123',
            scenarioPathId: 'path-123',
            scenarioId: 1,
            order: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ScenarioPathItem,
        },
        currentPathItem: null,
      };

      service.getNextScenarioPathItem.mockResolvedValue(
        mockNextScenarioPathItem as any,
      );

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toBeNull();
      expect(service.getNextScenarioPathItem).toHaveBeenCalledWith(
        scenarioSessionId,
      );
    });

    it('should return null when service returns null', async () => {
      service.getNextScenarioPathItem.mockResolvedValue(null);

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toBeNull();
      expect(service.getNextScenarioPathItem).toHaveBeenCalledWith(
        scenarioSessionId,
      );
    });

    it('should handle optional fields gracefully', async () => {
      const mockNextScenarioPathItem = {
        nextScenarioSessionItem: {
          id: 'session-item-123',
          scenarioPathSessionId: 'session-123',
          userId: 123,
          scenarioPathItemId: 'path-item-123',
          status: SessionItemStatus.UNLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathSessionItem,
        nextScenarioData: {
          scenario: mockScenario,
          pathItem: {
            id: 'path-item-123',
            scenarioPathId: 'path-123',
            scenarioId: 1,
            order: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ScenarioPathItem,
        },
        currentPathItem: {
          id: 'current-path-item-123',
          scenarioPathId: 'path-123',
          scenarioId: 1,
          order: 1,
          messageTitle: undefined,
          messageContent: undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScenarioPathItem,
      };

      service.getNextScenarioPathItem.mockResolvedValue(
        mockNextScenarioPathItem as any,
      );

      const result =
        await controller.getUpcomingScenarioPathItem(scenarioSessionId);

      expect(result).toEqual({
        ...mockScenario,
        order: 2,
        scenarioPathSessionItemId: 'session-item-123',
        transitionMessageTitle: undefined,
        transitionMessageContent: undefined,
      });
    });

    it('should handle errors from service', async () => {
      const error = new Error('Service error');
      service.getNextScenarioPathItem.mockRejectedValue(error);

      await expect(
        controller.getUpcomingScenarioPathItem(scenarioSessionId),
      ).rejects.toThrow('Service error');
    });
  });
});
