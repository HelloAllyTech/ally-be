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
  let chatRepository: jest.Mocked<ChatRepository>;
  let callDetailsRepository: jest.Mocked<CallDetailsRepository>;
  let callDetailsService: jest.Mocked<CallDetailsService>;
  let userService: jest.Mocked<UserService>;

  const mockTenantId = 'test-tenant';

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'johndoe',
    tenantId: mockTenantId,
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
    tenantId: mockTenantId,
    externalId: undefined,
    archivedAt: undefined,
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
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(mockTenantId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallLogService,
        {
          provide: ChatRepository,
          useValue: {
            getCallLogsQuery: jest.fn(),
            getAdminCallLogsQuery: jest.fn(),
          },
        },
        {
          provide: CallDetailsRepository,
          useValue: {
            getAllTags: jest.fn(),
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
    chatRepository = module.get(ChatRepository);
    callDetailsRepository = module.get(CallDetailsRepository);
    callDetailsService = module.get(CallDetailsService);
    userService = module.get(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCallLogs', () => {
    it('should get call logs for a counselor with pagination', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      chatRepository.getCallLogsQuery.mockResolvedValue({
        data: [mockCallLog as any],
        count: 1,
      });

      const result = await service.getCallLogs(mockTokenUser, {
        limit: 10,
        offset: 0,
      });

      expect(chatRepository.getCallLogsQuery).toHaveBeenCalledWith({
        counselorId: mockTokenUser.id,
        tenantId: mockTenantId,
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
        archive: undefined,
      });
      expect(result).toEqual({
        data: [mockCallLog],
        count: 1,
      });
    });

    it('should decrypt call details for each call log', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      chatRepository.getCallLogsQuery.mockResolvedValue({
        data: [mockCallLog as any, mockCallLog as any],
        count: 2,
      });
      callDetailsService.decryptCallDetails.mockResolvedValue(mockCallDetails);

      const result = await service.getCallLogs(mockTokenUser, {});

      expect(callDetailsService.decryptCallDetails).toHaveBeenCalledTimes(2);
      expect(result.count).toBe(2);
    });

    it('should handle call logs without details', async () => {
      const mockCallLogNoDetails = { ...mockChat, details: null };
      chatRepository.getCallLogsQuery.mockResolvedValue({
        data: [mockCallLogNoDetails as any],
        count: 1,
      });
      callDetailsService.decryptCallDetails.mockResolvedValue(undefined);

      const result = await service.getCallLogs(mockTokenUser, {});

      expect(result.data[0].details).toEqual({});
    });
  });

  describe('getAdminCallLogs', () => {
    it('should get admin call logs with filters', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      chatRepository.getAdminCallLogsQuery.mockResolvedValue({
        data: [mockCallLog as any],
        count: 1,
      });

      const filters: CallLogFilters = {
        limit: 10,
        offset: 0,
        sortBy: CallLogSortBy.START_DATE,
        order: SortOrder.DESC,
        counselorName: 'John',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const result = await service.getAdminCallLogs(filters);

      expect(chatRepository.getAdminCallLogsQuery).toHaveBeenCalledWith(
        mockTenantId,
        filters,
      );
      expect(result).toEqual({
        data: [mockCallLog],
        count: 1,
      });
    });

    it('should decrypt call details for admin logs', async () => {
      const mockCallLog = { ...mockChat, details: mockCallDetails };
      chatRepository.getAdminCallLogsQuery.mockResolvedValue({
        data: [mockCallLog as any],
        count: 1,
      });

      await service.getAdminCallLogs({});

      expect(callDetailsService.decryptCallDetails).toHaveBeenCalled();
    });

    it('should handle call logs without details', async () => {
      const mockCallLogNoDetails = { ...mockChat, details: null };
      chatRepository.getAdminCallLogsQuery.mockResolvedValue({
        data: [mockCallLogNoDetails as any],
        count: 1,
      });
      callDetailsService.decryptCallDetails.mockResolvedValue(undefined);

      const result = await service.getAdminCallLogs({});

      expect(result.data[0].details).toEqual({});
    });
  });

  describe('getCounselorNames', () => {
    it('should delegate to userService', async () => {
      const mockCounselorNames = ['John Doe', 'Jane Smith'];
      userService.getCounselorNames.mockResolvedValue(
        mockCounselorNames as any,
      );

      const result = await service.getCounselorNames(10, 0, 'John');

      expect(userService.getCounselorNames).toHaveBeenCalledWith(10, 0, 'John');
      expect(result).toEqual(mockCounselorNames);
    });

    it('should work without parameters', async () => {
      const mockCounselorNames = ['John Doe', 'Jane Smith'];
      userService.getCounselorNames.mockResolvedValue(
        mockCounselorNames as any,
      );

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
      callDetailsRepository.getAllTags.mockResolvedValue({
        data: ['anxiety', 'support'],
        count: 2,
      });

      const result = await service.getAllTags(10, 0);

      expect(callDetailsRepository.getAllTags).toHaveBeenCalledWith(
        mockTenantId,
        10,
        0,
        undefined,
      );
      expect(result).toEqual({
        data: ['anxiety', 'support'],
        count: 2,
      });
    });

    it('should pass search parameter', async () => {
      callDetailsRepository.getAllTags.mockResolvedValue({
        data: ['anxiety'],
        count: 1,
      });

      await service.getAllTags(10, 0, 'anxiety');

      expect(callDetailsRepository.getAllTags).toHaveBeenCalledWith(
        mockTenantId,
        10,
        0,
        'anxiety',
      );
    });

    it('should work without parameters', async () => {
      callDetailsRepository.getAllTags.mockResolvedValue({
        data: [],
        count: 0,
      });

      await service.getAllTags();

      expect(callDetailsRepository.getAllTags).toHaveBeenCalledWith(
        mockTenantId,
        undefined,
        undefined,
        undefined,
      );
    });
  });
});
