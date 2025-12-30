import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessionMessagesRepository } from '../scenario-session-messages.repository';
import { ScenarioSessionMessages } from '../../entity/scenario-session-messages.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionMessageType } from '../../enum/scenario-session-message.type.enum';

// Mock static classes
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

describe('ScenarioSessionMessagesRepository', () => {
  let repository: ScenarioSessionMessagesRepository;
  let mockEntityManager: any;
  let mockQueryBuilder: jest.Mocked<
    SelectQueryBuilder<ScenarioSessionMessages>
  >;

  const mockTenantId = 'tenant-123';
  const mockScenarioSessionId = 'session-123';
  const mockSenderId = 123;

  const mockMessage: ScenarioSessionMessages = {
    id: 1,
    scenarioSessionId: mockScenarioSessionId,
    senderId: mockSenderId,
    messageType: ScenarioSessionMessageType.TEXT,
    content: 'Test message',
    metadata: { source: 'test' },
    startSeconds: 10.5,
    endSeconds: 15.2,
    tenantId: mockTenantId,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  } as ScenarioSessionMessages;

  const mockPagination: Pagination = {
    limit: 10,
    offset: 0,
    sortBy: 'createdAt',
    order: 'DESC',
  };

  beforeEach(async () => {
    // Create mock query builder
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    } as any;

    mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    };

    // Setup ExecutionManager mocks
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockSenderId);
    (ExecutionManager.getExecutionId as jest.Mock).mockReturnValue('exec-123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionMessagesRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ScenarioSessionMessagesRepository>(
      ScenarioSessionMessagesRepository,
    );

    // Mock repository methods
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessagesByScenarioSessionId', () => {
    it('should return messages with default sorting and pagination', async () => {
      const mockMessages = [mockMessage];
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(result).toEqual(mockMessages);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('message');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.scenarioSessionId = :scenarioSessionId',
        { scenarioSessionId: mockScenarioSessionId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
    });

    it('should apply custom sorting when sortBy and order are provided', async () => {
      const mockMessages = [mockMessage];
      const customPagination: Pagination = {
        ...mockPagination,
        sortBy: 'startSeconds',
        order: 'ASC',
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        customPagination,
      );

      expect(result).toEqual(mockMessages);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.startSeconds',
        'ASC',
      );
    });

    it('should apply default sorting when sortBy is not provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithoutSortBy: Pagination = {
        ...mockPagination,
        sortBy: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithoutSortBy,
      );

      expect(result).toEqual(mockMessages);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
    });

    it('should apply default order when order is not provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithoutOrder: Pagination = {
        ...mockPagination,
        order: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithoutOrder,
      );

      expect(result).toEqual(mockMessages);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'ASC',
      );
    });

    it('should apply both default sortBy and order when both are not provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithDefaults: Pagination = {
        ...mockPagination,
        sortBy: undefined,
        order: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithDefaults,
      );

      expect(result).toEqual(mockMessages);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'ASC',
      );
    });

    it('should apply pagination when limit is provided', async () => {
      const mockMessages = [mockMessage];
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(mockPagination.limit);
    });

    it('should apply pagination when offset is provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithOffset = { ...mockPagination, offset: 20 };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithOffset,
      );

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(
        paginationWithOffset.offset,
      );
    });

    it('should not apply limit when not provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithoutLimit: Pagination = {
        ...mockPagination,
        limit: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithoutLimit,
      );

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should not apply offset when not provided', async () => {
      const mockMessages = [mockMessage];
      const paginationWithoutOffset: Pagination = {
        ...mockPagination,
        offset: undefined,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithoutOffset,
      );

      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle empty result', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should handle multiple messages', async () => {
      const mockMessages: ScenarioSessionMessages[] = [
        mockMessage,
        {
          ...mockMessage,
          id: 2,
          content: 'Second message',
          senderId: -1, // Client message
        } as ScenarioSessionMessages,
        {
          ...mockMessage,
          id: 3,
          content: 'Third message',
          startSeconds: 20.0,
          endSeconds: 25.5,
        } as ScenarioSessionMessages,
      ];
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        mockPagination,
      );

      expect(result).toEqual(mockMessages);
      expect(result).toHaveLength(3);
    });

    it('should work with zero limit', async () => {
      const mockMessages: ScenarioSessionMessages[] = [];
      const paginationWithZeroLimit: Pagination = {
        ...mockPagination,
        limit: 0,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithZeroLimit,
      );

      // limit: 0 should not call limit method due to falsy check
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should work with zero offset', async () => {
      const mockMessages = [mockMessage];
      const paginationWithZeroOffset: Pagination = {
        ...mockPagination,
        offset: 0,
      };
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        mockScenarioSessionId,
        paginationWithZeroOffset,
      );

      // offset: 0 should not call offset method due to falsy check
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle different scenario session IDs', async () => {
      const mockMessages = [mockMessage];
      const differentSessionId = 'different-session-123';
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      await repository.getMessagesByScenarioSessionId(
        differentSessionId,
        mockPagination,
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.scenarioSessionId = :scenarioSessionId',
        { scenarioSessionId: differentSessionId },
      );
    });
  });
});
