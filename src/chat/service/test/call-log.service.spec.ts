import { Test, TestingModule } from '@nestjs/testing';
import { CallLogService } from '../call-log.service';
import { ChatRepository } from '../../repository/chat.repository';
import { CallDetailsRepository } from '../../repository/call-details.repository';
import { CallDetailsService } from '../call-details.service';
import { UserService } from '../../../user/service/user.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import {
  CallLogFilters,
  CallLogSortBy,
  SortOrder,
} from '../../dto/call-log.request.dto';
import { TokenUser } from '../../../auth/type/auth.types';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from 'src/chat/entity/chat.entity';
import { CallDetails } from 'src/chat/entity/call.details.entity';

describe('CallLogService', () => {
  let service: CallLogService;
  let chatRepository: ChatRepository;
  let callDetailsRepository: CallDetailsRepository;
  let callDetailsService: CallDetailsService;
  let userService: UserService;

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'johndoe',
    tenantId: 'test-tenant',
  };

  const mockChat: Chat = {
    id: 1,
    clientId: 100,
    counselorId: 1,
    status: ChatStatus.ENDED,
    summaryStatus: ChatSummaryStatus.SUCCESS,
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: new Date('2024-01-01T10:30:00Z'),
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
  };

  const mockCallDetails: CallDetails = {
    id: 1,
    chatId: 1,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T10:30:00Z'),
    callDuration: 1800,
    callInfo: {
      provider: AudioChatProvider.WEBRTC,
      platform: AudioChatPlatform.WEB,
    },
    summary: {
      callId: '1',
      callDuration: 1800,
      callDate: '2024-01-01',
      callTime: '10:00:00',
      clientId: '100',
      counsellor: 'John Doe',
      callType: 'Regular',
      age: 25,
      gender: 'Male',
      profession: 'Engineer',
      relationshipStatus: 'Single',
      languages: [],
      location: 'Test City',
      codeOfConcern: 'Anxiety',
      sessionSummary: 'Test summary',
      counselingProcessFlow: 'Test flow',
      keyConcerns: 'Test concerns',
      subjectiveObservations: 'Test observations',
      objectiveObservations: 'Test objective',
      assessment: 'Test assessment',
      dominantFeelings: 'Test feelings',
      issuesWorkedOn: 'Test issues',
      keyTherapeuticTechniques: 'Test techniques',
      referralsProvided: null,
      homework: 'Test homework',
      planForNextCall: 'Test plan',
      tags: [
        { tag: 'anxiety', positivity_rating: 0.3 },
        { tag: 'support', positivity_rating: 0.8 },
      ],
      listeningShare: 0.5,
      reflectiveQuestionsAsked: 5,
      openEndedQuestionsAsked: 3,
      emotionalLift: 'Positive',
      callQuality: 4,
      newCallFollowUp: 'Follow up notes',
    },
    noOfNudges: 2,
    noOfStages: 3,
    transcript: 'Test transcript',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockQueryBuilder = () => ({
    leftJoinAndMapOne: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  });

  beforeEach(async () => {
    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallLogService,
        {
          provide: ChatRepository,
          useValue: {
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            findOne: jest.fn(),
          },
        },
        {
          provide: CallDetailsRepository,
          useValue: {
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            findOne: jest.fn(),
          },
        },
        {
          provide: CallDetailsService,
          useValue: {
            decryptCallDetails: jest.fn((details) => Promise.resolve(details)),
          },
        },
        {
          provide: UserService,
          useValue: {
            getCounselorNames: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CallLogService>(CallLogService);
    chatRepository = module.get<ChatRepository>(ChatRepository);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    callDetailsService = module.get<CallDetailsService>(CallDetailsService);
    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCallLogs', () => {
    it('should get call logs for a counselor with pagination', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockCallLog], 1]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getCallLogs(mockTokenUser, {
        limit: 10,
        offset: 0,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'chat.counselorId = :counselorId',
        { counselorId: 1 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.tenantId = :tenantId',
        { tenantId: 'test-tenant' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.status = :status',
        { status: ChatStatus.ENDED },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // Note: offset(0) is not called because 0 is falsy in JavaScript
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockCallLog],
        count: 1,
      });
    });

    it('should apply sorting when sortBy is provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getCallLogs(mockTokenUser, {
        limit: 10,
        offset: 0,
        sortBy: 'callDuration',
        order: 'DESC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'details.callDuration',
        'DESC',
      );
    });

    it('should not apply limit when not provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getCallLogs(mockTokenUser, {});

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should decrypt call details for each call log', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [mockCallLog, mockCallLog],
        2,
      ]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(callDetailsService, 'decryptCallDetails')
        .mockResolvedValue(mockCallDetails);

      const result = await service.getCallLogs(mockTokenUser, {});

      expect(callDetailsService.decryptCallDetails).toHaveBeenCalledTimes(2);
      expect(result.count).toBe(2);
    });

    it('should handle call logs without details', async () => {
      const mockCallLogNoDetails = { ...mockChat, details: null };
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [mockCallLogNoDetails],
        1,
      ]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(callDetailsService, 'decryptCallDetails')
        .mockResolvedValue(undefined);

      const result = await service.getCallLogs(mockTokenUser, {});

      expect(result.data[0].details).toEqual({});
    });
  });

  describe('getAdminCallLogs', () => {
    it('should get admin call logs with all filters applied', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockCallLog], 1]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const filters: CallLogFilters = {
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

      const result = await service.getAdminCallLogs(filters);

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');
      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledTimes(3);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.status = :status',
        { status: ChatStatus.ENDED },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // Note: offset(0) is not called because 0 is falsy in JavaScript
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockCallLog],
        count: 1,
      });
    });

    it('should apply default sorting when not provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAdminCallLogs({});

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.startedAt',
        'DESC',
      );
    });

    it('should not apply pagination when limit/offset not provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAdminCallLogs({});

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should decrypt call details for admin logs', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockCallLog], 1]);

      jest
        .spyOn(chatRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAdminCallLogs({});

      expect(callDetailsService.decryptCallDetails).toHaveBeenCalled();
    });
  });

  describe('applyStringFilters', () => {
    it('should apply counselor name filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { counselorName: 'John Doe' };

      service['applyStringFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'counselor.name ILIKE :counselorName',
        { counselorName: '%John Doe%' },
      );
    });

    it('should not apply filter when counselor name is not provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyStringFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('applyIdFilters', () => {
    it('should apply counselor IDs filter with valid IDs', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { counselorIds: '1, 2, 3' };

      service['applyIdFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.counselorId IN (:...counselorIds)',
        { counselorIds: [1, 2, 3] },
      );
    });

    it('should filter out invalid IDs', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { counselorIds: '1, invalid, 3, abc' };

      service['applyIdFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.counselorId IN (:...counselorIds)',
        { counselorIds: [1, 3] },
      );
    });

    it('should not apply filter when no valid IDs', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { counselorIds: 'invalid, not-a-number' };

      service['applyIdFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should not apply filter when counselorIds is not provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyIdFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('applyDateFilters', () => {
    it('should apply start date filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { startDate: '2024-01-01T00:00:00Z' };

      service['applyDateFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt >= :startDate',
        { startDate: new Date('2024-01-01T00:00:00Z') },
      );
    });

    it('should apply end date filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { endDate: '2024-12-31T23:59:59Z' };

      service['applyDateFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt <= :endDate',
        { endDate: new Date('2024-12-31T23:59:59Z') },
      );
    });

    it('should apply both start and end date filters', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      };

      service['applyDateFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt >= :startDate',
        { startDate: new Date('2024-01-01T00:00:00Z') },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'chat.startedAt <= :endDate',
        { endDate: new Date('2024-12-31T23:59:59Z') },
      );
    });

    it('should not apply filters when dates are not provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyDateFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('applyDurationFilters', () => {
    it('should apply min duration filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { minDuration: 60 };

      service['applyDurationFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration >= :minDuration',
        { minDuration: 60 },
      );
    });

    it('should apply max duration filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { maxDuration: 3600 };

      service['applyDurationFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration <= :maxDuration',
        { maxDuration: 3600 },
      );
    });

    it('should apply both min and max duration filters', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { minDuration: 60, maxDuration: 3600 };

      service['applyDurationFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration >= :minDuration',
        { minDuration: 60 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration <= :maxDuration',
        { maxDuration: 3600 },
      );
    });

    it('should handle minDuration of 0', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { minDuration: 0 };

      service['applyDurationFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'details.callDuration >= :minDuration',
        { minDuration: 0 },
      );
    });

    it('should not apply filters when durations are not provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyDurationFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('applyQualityFilters', () => {
    it('should apply min quality score filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { minQualityScore: 3 };

      service['applyQualityFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        { minQualityScore: 3 },
      );
    });

    it('should apply max quality score filter', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { maxQualityScore: 5 };

      service['applyQualityFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
        { maxQualityScore: 5 },
      );
    });

    it('should apply both min and max quality score filters', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {
        minQualityScore: 3,
        maxQualityScore: 5,
      };

      service['applyQualityFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        { minQualityScore: 3 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
        { maxQualityScore: 5 },
      );
    });

    it('should not apply filters when quality scores are not provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyQualityFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('applyTagFilters', () => {
    it('should apply base tag filter only when no tags provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = {};

      service['applyTagFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(1);
    });

    it('should apply tag matching filter when tags provided', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { tags: 'anxiety, support' };

      service['applyTagFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags: ['anxiety', 'support'] },
      );
    });

    it('should handle single tag', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { tags: 'anxiety' };

      service['applyTagFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags: ['anxiety'] },
      );
    });

    it('should trim tag values', () => {
      const mockQueryBuilder = createMockQueryBuilder();
      const filters: CallLogFilters = { tags: '  anxiety  ,  support  ' };

      service['applyTagFilters'](mockQueryBuilder as any, filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags: ['anxiety', 'support'] },
      );
    });
  });

  describe('applySorting', () => {
    it('should sort by ID', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.ID,
        SortOrder.ASC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('chat.id', 'ASC');
    });

    it('should sort by counselor name', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.COUNSELOR_NAME,
        SortOrder.DESC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'counselor.name',
        'DESC',
      );
    });

    it('should sort by client ID', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.CLIENT_ID,
        SortOrder.ASC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.clientId',
        'ASC',
      );
    });

    it('should sort by call duration', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.CALL_DURATION,
        SortOrder.DESC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'details.callDuration',
        'DESC',
      );
    });

    it('should sort by start date', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.START_DATE,
        SortOrder.ASC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.startedAt',
        'ASC',
      );
    });

    it('should sort by quality score', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.QUALITY_SCORE,
        SortOrder.DESC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "CAST(details.summary->>'callQuality' AS NUMERIC)",
        'DESC',
      );
    });

    it('should sort by tags', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.TAGS,
        SortOrder.ASC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "details.summary->'tags'->0->>'tag'",
        'ASC',
      );
    });

    it('should sort by created at', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        CallLogSortBy.CREATED_AT,
        SortOrder.DESC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.createdAt',
        'DESC',
      );
    });

    it('should default to DESC order when not specified', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](mockQueryBuilder, CallLogSortBy.START_DATE);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.startedAt',
        'DESC',
      );
    });

    it('should default to created at sorting for invalid sortBy', () => {
      const mockQueryBuilder = createMockQueryBuilder();

      service['applySorting'](
        mockQueryBuilder,
        'invalid' as any,
        SortOrder.ASC,
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'chat.createdAt',
        'ASC',
      );
    });
  });

  describe('getCounselorNames', () => {
    it('should delegate to userService', async () => {
      const mockCounselorNames = ['John Doe', 'Jane Smith'];
      jest
        .spyOn(userService, 'getCounselorNames')
        .mockResolvedValue(mockCounselorNames as any);

      const result = await service.getCounselorNames(10, 0, 'John');

      expect(userService.getCounselorNames).toHaveBeenCalledWith(10, 0, 'John');
      expect(result).toEqual(mockCounselorNames);
    });

    it('should work without parameters', async () => {
      const mockCounselorNames = ['John Doe', 'Jane Smith'];
      jest
        .spyOn(userService, 'getCounselorNames')
        .mockResolvedValue(mockCounselorNames as any);

      const result = await service.getCounselorNames();

      expect(userService.getCounselorNames).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
      expect(result).toEqual(mockCounselorNames);
    });
  });

  describe('getAllTags', () => {
    it('should get all tags with pagination', async () => {
      const mockTags = [{ tag: 'anxiety' }, { tag: 'support' }];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue(mockTags);
      mockQueryBuilder.getCount.mockResolvedValue(2);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getAllTags(10, 0);

      expect(callDetailsRepository.createQueryBuilder).toHaveBeenCalledWith(
        'details',
      );
      expect(mockQueryBuilder.select).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "details.summary->'tags' IS NOT NULL",
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_typeof(details.summary->'tags') = 'array'",
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // Note: offset(0) is not called because 0 is falsy in JavaScript
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: ['anxiety', 'support'],
        count: 2,
      });
    });

    it('should apply search filter when provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAllTags(10, 0, 'anxiety');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        { search: '%anxiety%' },
      );
    });

    it('should trim search value', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAllTags(10, 0, '  anxiety  ');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        { search: '%anxiety%' },
      );
    });

    it('should not apply search filter for empty string', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAllTags(10, 0, '   ');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('should filter out empty tags', async () => {
      const mockTags = [
        { tag: 'anxiety' },
        { tag: '' },
        { tag: '  ' },
        { tag: 'support' },
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue(mockTags);
      mockQueryBuilder.getCount.mockResolvedValue(4);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getAllTags();

      expect(result.data).toEqual(['anxiety', 'support']);
    });

    it('should work without pagination parameters', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAllTags();

      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should order tags alphabetically', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue([]);
      mockQueryBuilder.getCount.mockResolvedValue(0);

      jest
        .spyOn(callDetailsRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getAllTags();

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tag', 'ASC');
    });
  });
});
