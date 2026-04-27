import { Test, TestingModule } from '@nestjs/testing';
import { ChatRepository } from '../chat.repository';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Chat, ChatStatus } from '../../entity/chat.entity';
import { UpdateChatInput } from '../../type/chat.type';
import { ChatSummaryStatus } from '../../entity/chat.entity';
import { CallLogSortBy, SortOrder } from '../../dto/call-log.request.dto';

describe('ChatRepository', () => {
  let repository: ChatRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let chatRepo: jest.Mocked<Repository<Chat>>;
  let mockQueryBuilder: any;

  const mockUpdateChatInput: UpdateChatInput = {
    summaryStatus: ChatSummaryStatus.SUCCESS,
    metadata: { key: 'value' },
  };

  const mockUserId = 123;
  const mockTenantId = 'test-tenant';

  beforeEach(async () => {
    mockQueryBuilder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      leftJoinAndMapMany: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getManyAndCount: jest.fn(),
    };

    const mockCreateQueryBuilder = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue(mockQueryBuilder),
      ...mockQueryBuilder,
    });

    chatRepo = {
      createQueryBuilder: mockCreateQueryBuilder,
      update: jest.fn().mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      }),
    } as any;

    entityManager = {
      getRepository: jest.fn().mockReturnValue(chatRepo),
    } as any;

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(entityManager),
      getRepository: jest.fn().mockReturnValue(chatRepo),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<ChatRepository>(ChatRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    // it('should initialize with DataSource', () => {
    //   expect(repository).toBeDefined();
    //   expect(dataSource.createEntityManager).toHaveBeenCalled();
    // });
  });

  describe('updateChat', () => {
    // it('should return false when no updates are provided', async () => {
    //   const emptyInput: UpdateChatInput = {};
    //   mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

    //   const result = await repository.updateChat(1, emptyInput);

    //   expect(result).toBe(false);
    //   expect(chatRepo.createQueryBuilder).toHaveBeenCalledWith('chat');
    //   expect(mockQueryBuilder.set).not.toHaveBeenCalled();
    //   expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :chatId', {
    //     chatId: 1,
    //   });
    // });

    it('should return false when update affects 0 rows', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(false);
      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });

    it('should return true when update affects rows', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await repository.updateChat(1, mockUpdateChatInput);

      expect(result).toBe(true);
      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });

    it('should set metadata as function that returns correct SQL', async () => {
      const inputWithMetadata: UpdateChatInput = {
        metadata: { key: 'value' },
      };
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, inputWithMetadata);

      expect(chatRepo.update).toHaveBeenCalledWith(1, inputWithMetadata);
    });

    it('should use EntityManager when provided', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput, entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(Chat);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should use DataSource when EntityManager not provided', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(dataSource.getRepository).toHaveBeenCalledWith(Chat);
      expect(entityManager.getRepository).not.toHaveBeenCalled();
    });

    it('should handle both summaryStatus and metadata updates', async () => {
      chatRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await repository.updateChat(1, mockUpdateChatInput);

      expect(chatRepo.update).toHaveBeenCalledWith(1, mockUpdateChatInput);
    });
  });

  describe('findChatWithDetails', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should return chat with details when found', async () => {
      const mockChatWithDetails = {
        id: 1,
        tenantId: mockTenantId,
        status: ChatStatus.ENDED,
        details: {
          chatId: 1,
          callDuration: 1800,
          summary: { sessionSummary: 'Test summary' },
        },
      };
      mockQueryBuilder.getOne = jest
        .fn()
        .mockResolvedValue(mockChatWithDetails);

      const result = await repository.findChatWithDetails(1, mockTenantId);

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'chat.details',
        expect.anything(),
        'details',
        'details.chatId = chat.id',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('chat.id = :id', {
        id: 1,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(result).toEqual(mockChatWithDetails);
    });

    it('should use correct parameters for different chat ids', async () => {
      const chatId = 999;
      mockQueryBuilder.getOne = jest.fn().mockResolvedValue(null);

      await repository.findChatWithDetails(chatId, mockTenantId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('chat.id = :id', {
        id: chatId,
      });
    });

    it('should use correct parameters for different tenant ids', async () => {
      const differentTenantId = 'different-tenant';
      mockQueryBuilder.getOne = jest.fn().mockResolvedValue(null);

      await repository.findChatWithDetails(1, differentTenantId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.tenantId = :tenantId',
        { tenantId: differentTenantId },
      );
    });

    it('should call query methods in correct order', async () => {
      const callOrder: string[] = [];
      mockQueryBuilder.leftJoinAndMapOne = jest.fn(() => {
        callOrder.push('leftJoinAndMapOne');
        return mockQueryBuilder;
      });
      mockQueryBuilder.where = jest.fn(() => {
        callOrder.push('where');
        return mockQueryBuilder;
      });
      mockQueryBuilder.andWhere = jest.fn(() => {
        callOrder.push('andWhere');
        return mockQueryBuilder;
      });
      mockQueryBuilder.getOne = jest.fn(() => {
        callOrder.push('getOne');
        return Promise.resolve(null);
      });

      await repository.findChatWithDetails(1, mockTenantId);

      expect(callOrder).toEqual([
        'leftJoinAndMapOne',
        'where',
        'andWhere',
        'getOne',
      ]);
    });
  });

  describe('getCounselorStatsRaw', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the repository instance's createQueryBuilder method
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should build query with date range filter', async () => {
      const queryParams = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const mockResult = {
        counselorName: 'John Doe',
        counselorListeningDuration: '1800.50',
        counselorSharingDuration: '600.25',
      };

      mockQueryBuilder.getRawOne.mockResolvedValue(mockResult);

      const result = await repository.getCounselorStatsRaw(
        queryParams,
        mockUserId,
      );

      expect(result).toEqual(mockResult);
      expect(createQueryBuilderSpy).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" BETWEEN :startDate AND :endDate',
        {
          startDate: '2024-01-01 00:00:00',
          endDate: '2024-01-31 23:59:59',
        },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: mockUserId },
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalled();
    });

    it('should build query with only start date filter', async () => {
      const queryParams = { startDate: '2024-01-01' };

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Jane Doe',
        counselorListeningDuration: '1800.5',
        counselorSharingDuration: '600.25',
      });

      await repository.getCounselorStatsRaw(queryParams, mockUserId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" >= :startDate',
        { startDate: '2024-01-01 00:00:00' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: mockUserId },
      );
    });

    it('should build query with only end date filter', async () => {
      const queryParams = { endDate: '2024-01-31' };

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Bob Smith',
        counselorListeningDuration: '100',
        counselorSharingDuration: '50',
      });

      await repository.getCounselorStatsRaw(queryParams, mockUserId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" <= :endDate',
        { endDate: '2024-01-31 23:59:59' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: mockUserId },
      );
    });

    it('should build query without date filters', async () => {
      const queryParams = {};

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Alice Johnson',
        counselorListeningDuration: '200',
        counselorSharingDuration: '100',
      });

      await repository.getCounselorStatsRaw(queryParams, mockUserId);

      // Should not have date filter calls, only the userId filter and base where clauses
      const andWhereCalls = mockQueryBuilder.andWhere.mock.calls;
      const dateFilterCalls = andWhereCalls.filter(
        (call: any[]) =>
          call[0].includes('startedAt') || call[0].includes('BETWEEN'),
      );
      expect(dateFilterCalls).toHaveLength(0);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: mockUserId },
      );
    });

    it('should return null when no data found', async () => {
      const queryParams = {};

      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await repository.getCounselorStatsRaw(
        queryParams,
        mockUserId,
      );

      expect(result).toBeNull();
    });

    it('should apply all base where clauses for call details validation', async () => {
      const queryParams = {};

      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      await repository.getCounselorStatsRaw(queryParams, mockUserId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
    });
  });

  describe('getCallLogsQuery', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should build query with pagination', async () => {
      const mockChats = [{ id: 1 }, { id: 2 }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockChats, 2]);

      const result = await repository.getCallLogsQuery({
        counselorId: mockUserId,
        tenantId: mockTenantId,
        limit: 10,
        offset: 5,
      });

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'chat.counselorId = :counselorId',
        { counselorId: mockUserId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.tenantId = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.status = :status',
        { status: ChatStatus.ENDED },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
      expect(result).toEqual({ data: mockChats, count: 2 });
    });

    it('should apply sorting when sortBy is provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getCallLogsQuery({
        counselorId: mockUserId,
        tenantId: mockTenantId,
        sortBy: 'callDuration',
        order: 'DESC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'details.callDuration',
        'DESC',
      );
    });

    it('should not apply limit/offset when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getCallLogsQuery({
        counselorId: mockUserId,
        tenantId: mockTenantId,
      });

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });
  });

  describe('getAdminCallLogsQuery', () => {
    let createQueryBuilderSpy: jest.SpyInstance;

    beforeEach(() => {
      createQueryBuilderSpy = jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
    });

    afterEach(() => {
      createQueryBuilderSpy.mockRestore();
    });

    it('should build query with all filters', async () => {
      const mockChats = [{ id: 1 }];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockChats, 1]);

      const filters = {
        limit: 10,
        offset: 0,
        sortBy: CallLogSortBy.START_DATE,
        order: SortOrder.DESC,
        counselorName: 'John',
        counselorIds: '1,2,3',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        minDuration: 60,
        maxDuration: 3600,
        minQualityScore: 3,
        maxQualityScore: 5,
        tags: 'anxiety,support',
      };

      const result = await repository.getAdminCallLogsQuery(
        mockTenantId,
        filters,
      );

      expect(createQueryBuilderSpy).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledTimes(3);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.status = :status',
        { status: ChatStatus.ENDED },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.tenant_id = :tenantId',
        { tenantId: mockTenantId },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual({ data: mockChats, count: 1 });
    });

    it('should apply default sorting when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.startedAt',
        'DESC',
      );
    });

    it('should apply counselor name filter', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        counselorName: 'John Doe',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'counselor.name ILIKE :counselorName',
        { counselorName: '%John Doe%' },
      );
    });

    it('should apply counselor IDs filter', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        counselorIds: '1, 2, 3',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.counselorId IN (:...counselorIds)',
        { counselorIds: [1, 2, 3] },
      );
    });

    it('should apply date filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt >= :startDate',
        { startDate: new Date('2024-01-01T00:00:00Z') },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt <= :endDate',
        { endDate: new Date('2024-12-31T23:59:59Z') },
      );
    });

    it('should apply duration filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        minDuration: 60,
        maxDuration: 3600,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration >= :minDuration',
        { minDuration: 60 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration <= :maxDuration',
        { maxDuration: 3600 },
      );
    });

    it('should apply quality score filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        minQualityScore: 3,
        maxQualityScore: 5,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        { minQualityScore: 3 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
        { maxQualityScore: 5 },
      );
    });

    it('should apply tag filters', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        tags: 'anxiety, support',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags: ['anxiety', 'support'] },
      );
    });

    it('should apply callName filter using ILIKE on callInfo summaryName JSONB field', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {
        callName: 'Crisis Call',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `details.callInfo->>'summaryName' ILIKE :callName`,
        { callName: '%Crisis Call%' },
      );
    });

    it('should not add callName filter when callName is not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAdminCallLogsQuery(mockTenantId, {});

      const andWhereCalls = (mockQueryBuilder.andWhere as jest.Mock).mock.calls;
      const callNameCall = andWhereCalls.find(
        (args) =>
          typeof args[0] === 'string' && args[0].includes('summaryName'),
      );
      expect(callNameCall).toBeUndefined();
    });
  });
});
