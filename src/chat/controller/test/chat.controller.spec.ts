import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from '../chat.controller';
import { ChatService } from '../../service/chat.service';
import { FeedbackService } from '../../service/feedback.service';
import { ChatSummaryService } from '../../service/chat-summary.service';
import { TokenUser } from '../../../auth/type/auth.types';
import { UserRole } from '../../../common/constants/user.constants';
import { ChatStatus } from '../../../common/entities/chat.entity';
import { CallLogSortBy, SortOrder } from '../../dto/call-log.request.dto';
import { CreateFeedbackDto } from '../../dto/create-feedback.dto';
import { AddNoteDto } from '../../dto/notes.dto';
import { SummaryFeedbackDto } from '../../dto/summary-feedback.dto';
import { CallInfoDto } from '../../dto/chat.response.dto';
import { PermissionsService } from '../../../authorization/service/permissions.service';

describe('ChatController', () => {
  let controller: ChatController;
  let mockChatService: any;
  let mockFeedbackService: any;
  let mockChatSummaryService: any;

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'testuser',
    tenantId: 'test-tenant',
  };

  const mockCounselorUser: TokenUser = {
    id: 2,
    username: 'counselor',
    tenantId: 'test-tenant',
  };

  const mockChat = {
    id: 1,
    clientId: 1,
    counselorId: 2,
    status: ChatStatus.ACTIVE,
    startedAt: new Date(),
    endedAt: null,
  };

  const mockCallLogs = {
    data: [mockChat],
    count: 1,
  };

  const mockMessages = {
    data: [
      {
        messageId: 1,
        chatId: 1,
        senderId: 1,
        messageType: 'TEXT',
        content: 'Test message',
        context: null,
        createdAt: new Date().toISOString(),
        feedback: null,
        startSeconds: null,
        endSeconds: null,
      },
    ],
    count: 1,
  };

  const mockFeedback = {
    feedbackId: 1,
    messageId: 1,
    userId: 2,
    rating: 5,
    modifiedContent: 'Good message',
  };

  beforeEach(async () => {
    // Create explicit mock objects
    mockChatService = {
      getMyChats: jest.fn(),
      requestChat: jest.fn(),
      getCounselorChat: jest.fn(),
      getCallLogs: jest.fn(),
      getAdminCallLogs: jest.fn(),
      getCounselorNames: jest.fn(),
      getAllTags: jest.fn(),
      startCall: jest.fn(),
      accept: jest.fn(),
      endChat: jest.fn(),
      cancelCallByClient: jest.fn(),
      getMessages: jest.fn(),
      createFeedback: jest.fn(),
      getFeedback: jest.fn(),
      updateFeedback: jest.fn(),
      getChat: jest.fn(),
      enhance: jest.fn(),
      updateCallDetails: jest.fn(),
      generateSummary: jest.fn(),
      generateSummaryForMessage: jest.fn(),
      getNudge: jest.fn(),
      updateCallInfo: jest.fn(),
      tagPositivityRatings: jest.fn(),
      addNoteToSession: jest.fn(),
      addFeedbackToChat: jest.fn(),
    };

    mockFeedbackService = {
      create: jest.fn(),
      findByMessageId: jest.fn(),
      update: jest.fn(),
    };

    mockChatSummaryService = {
      exportSummary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: FeedbackService,
          useValue: mockFeedbackService,
        },
        {
          provide: ChatSummaryService,
          useValue: mockChatSummaryService,
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: jest.fn(),
            getUserPermissions: jest.fn(),
            getUserRoles: jest.fn().mockResolvedValue(['CLIENT']),
          },
        },
        {
          provide: 'Reflector',
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: 'RolesGuard',
          useValue: {
            canActivate: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMyChats', () => {
    it('should return user chats', async () => {
      mockChatService.getMyChats.mockResolvedValue(mockChat);

      const result = await controller.getMyChats(mockTokenUser);

      expect(result).toEqual(mockChat);
      expect(mockChatService.getMyChats).toHaveBeenCalledWith(mockTokenUser.id);
    });
  });

  describe('requestChat', () => {
    it('should request a new chat', async () => {
      const mockQueueEntry = { entryId: 1, chatId: 1, priority: 1 };
      mockChatService.requestChat.mockResolvedValue(mockQueueEntry);

      const result = await controller.requestChat(mockTokenUser);

      expect(result).toEqual(mockQueueEntry);
      expect(mockChatService.requestChat).toHaveBeenCalledWith(
        mockTokenUser.id,
      );
    });
  });

  describe('getCounselorChat', () => {
    it('should return counselor chat', async () => {
      mockChatService.getCounselorChat.mockResolvedValue(mockChat);

      const result = await controller.getCounselorChat(mockCounselorUser);

      expect(result).toEqual(mockChat);
      expect(mockChatService.getCounselorChat).toHaveBeenCalledWith(
        mockCounselorUser.id,
      );
    });
  });

  describe('getCallLogs', () => {
    it('should return call logs for counselor', async () => {
      mockChatService.getCallLogs.mockResolvedValue(mockCallLogs);

      const result = await controller.getCallLogs(
        mockCounselorUser,
        10,
        0,
        CallLogSortBy.CREATED_AT,
        SortOrder.DESC,
      );

      expect(result).toEqual(mockCallLogs);
      expect(mockChatService.getCallLogs).toHaveBeenCalledWith(
        mockCounselorUser,
        {
          limit: 10,
          offset: 0,
          sortBy: CallLogSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
    });

    it('should return call logs with default parameters', async () => {
      mockChatService.getCallLogs.mockResolvedValue(mockCallLogs);

      const result = await controller.getCallLogs(mockCounselorUser);

      expect(result).toEqual(mockCallLogs);
      expect(mockChatService.getCallLogs).toHaveBeenCalledWith(
        mockCounselorUser,
        {
          limit: undefined,
          offset: undefined,
          sortBy: CallLogSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
    });
  });

  describe('getAdminCallLogs', () => {
    it('should return admin call logs with filters', async () => {
      const filters = {
        limit: 10,
        offset: 0,
        sortBy: CallLogSortBy.START_DATE,
        order: SortOrder.DESC,
        counselorName: 'John',
        counselorIds: '1,2',
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        minDuration: 60,
        maxDuration: 3600,
        minQualityScore: 3,
        maxQualityScore: 5,
        tags: 'urgent,important',
      };

      mockChatService.getAdminCallLogs.mockResolvedValue(mockCallLogs);

      const result = await controller.getAdminCallLogs(
        filters.limit,
        filters.offset,
        filters.sortBy,
        filters.order,
        filters.counselorName,
        filters.counselorIds,
        filters.startDate,
        filters.endDate,
        filters.minDuration?.toString(),
        filters.maxDuration?.toString(),
        filters.minQualityScore?.toString(),
        filters.maxQualityScore?.toString(),
        filters.tags,
      );

      expect(result).toEqual(mockCallLogs);
      expect(mockChatService.getAdminCallLogs).toHaveBeenCalledWith(filters);
    });

    it('should handle undefined filter values', async () => {
      mockChatService.getAdminCallLogs.mockResolvedValue(mockCallLogs);

      const result = await controller.getAdminCallLogs(
        10,
        0,
        undefined,
        SortOrder.DESC,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result).toEqual(mockCallLogs);
      expect(mockChatService.getAdminCallLogs).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: SortOrder.DESC,
        counselorName: undefined,
        counselorIds: undefined,
        startDate: undefined,
        endDate: undefined,
        minDuration: undefined,
        maxDuration: undefined,
        minQualityScore: undefined,
        maxQualityScore: undefined,
        tags: undefined,
      });
    });
  });

  describe('getCounselorNames', () => {
    it('should return counselor names', async () => {
      const mockCounselorNames = {
        data: ['John Doe', 'Jane Smith'],
        count: 2,
      };

      mockChatService.getCounselorNames.mockResolvedValue(mockCounselorNames);

      const result = await controller.getCounselorNames(10, 0, 'John');

      expect(result).toEqual(mockCounselorNames);
      expect(mockChatService.getCounselorNames).toHaveBeenCalledWith(
        10,
        0,
        'John',
      );
    });
  });

  describe('getAllTags', () => {
    it('should return all tags', async () => {
      const mockTags = {
        data: ['urgent', 'important', 'follow-up'],
        count: 3,
      };

      mockChatService.getAllTags.mockResolvedValue(mockTags);

      const result = await controller.getAllTags(10, 0, 'urgent');

      expect(result).toEqual(mockTags);
      expect(mockChatService.getAllTags).toHaveBeenCalledWith(10, 0, 'urgent');
    });
  });

  describe('callStart', () => {
    it('should start a call', async () => {
      const callStartDto = {
        participantPhoneNumbers: ['+1234567890', '+0987654321'],
      };

      mockChatService.startCall.mockResolvedValue(mockChat);

      const result = await controller.callStart(callStartDto);

      expect(result).toEqual(mockChat);
      expect(mockChatService.startCall).toHaveBeenCalledWith(
        callStartDto.participantPhoneNumbers,
      );
    });
  });

  describe('accept', () => {
    it('should accept a chat', async () => {
      mockChatService.accept.mockResolvedValue(mockChat);

      const result = await controller.accept(mockCounselorUser, '1');

      expect(result).toEqual(mockChat);
      expect(mockChatService.accept).toHaveBeenCalledWith(
        mockCounselorUser.id,
        1,
      );
    });
  });

  describe('endChat', () => {
    it('should end a chat', async () => {
      mockChatService.endChat.mockResolvedValue(mockChat);

      const result = await controller.endChat('1');

      expect(result).toEqual(mockChat);
      expect(mockChatService.endChat).toHaveBeenCalledWith(1);
    });
  });

  describe('cancelCallByClient', () => {
    it('should cancel call by client', async () => {
      const mockResult = { success: true };
      mockChatService.cancelCallByClient.mockResolvedValue(mockResult);

      const result = await controller.cancelCallByClient(mockTokenUser, '1');

      expect(result).toEqual(mockResult);
      expect(mockChatService.cancelCallByClient).toHaveBeenCalledWith(
        mockTokenUser.id,
        1,
      );
    });
  });

  describe('getMessages', () => {
    it('should return messages for chat', async () => {
      mockChatService.getMessages.mockResolvedValue(mockMessages);

      const result = await controller.getMessages(
        mockTokenUser,
        '1',
        10,
        0,
        'createdAt',
        'DESC',
      );

      expect(result).toEqual(mockMessages);
      expect(mockChatService.getMessages).toHaveBeenCalledWith(
        1,
        mockTokenUser.id,
        {
          limit: 10,
          offset: 0,
          sortBy: 'createdAt',
          sortOrder: 'DESC',
        },
      );
    });

    it('should return messages with default parameters', async () => {
      mockChatService.getMessages.mockResolvedValue(mockMessages);

      const result = await controller.getMessages(mockTokenUser, '1');

      expect(result).toEqual(mockMessages);
      expect(mockChatService.getMessages).toHaveBeenCalledWith(
        1,
        mockTokenUser.id,
        {
          limit: undefined,
          offset: undefined,
          sortBy: undefined,
          sortOrder: undefined,
        },
      );
    });
  });

  describe('createFeedback', () => {
    it('should create feedback', async () => {
      const createFeedbackDto: CreateFeedbackDto = {
        content: 'Good message',
        rating: 5,
        isHelpful: true,
      };

      mockFeedbackService.create.mockResolvedValue(mockFeedback);

      const result = await controller.createFeedback(
        1,
        createFeedbackDto,
        mockCounselorUser,
      );

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackService.create).toHaveBeenCalledWith({
        ...createFeedbackDto,
        messageId: 1,
        userId: mockCounselorUser.id,
      });
    });
  });

  describe('getFeedback', () => {
    it('should return feedback for message', async () => {
      mockFeedbackService.findByMessageId.mockResolvedValue([mockFeedback]);

      const result = await controller.getFeedback(1);

      expect(result).toEqual([mockFeedback]);
      expect(mockFeedbackService.findByMessageId).toHaveBeenCalledWith(1);
    });
  });

  describe('updateFeedback', () => {
    it('should update feedback', async () => {
      const updateFeedbackDto: CreateFeedbackDto = {
        rating: 4,
        content: 'Updated comment',
        isHelpful: true,
      };

      mockFeedbackService.update.mockResolvedValue(mockFeedback);

      const result = await controller.updateFeedback(1, updateFeedbackDto);

      expect(result).toEqual(mockFeedback);
      expect(mockFeedbackService.update).toHaveBeenCalledWith(
        1,
        updateFeedbackDto,
      );
    });
  });

  describe('getChat', () => {
    it('should return chat details', async () => {
      mockChatService.getChat.mockResolvedValue(mockChat);

      const result = await controller.getChat(1);

      expect(result).toEqual(mockChat);
      expect(mockChatService.getChat).toHaveBeenCalledWith(1);
    });
  });

  describe('enhance', () => {
    it('should enhance summary content', async () => {
      const mockEnhancedContent = {
        enhanced_content: 'Enhanced summary content',
      };

      mockChatService.enhance.mockResolvedValue(mockEnhancedContent);

      const result = await controller.enhance({ content: 'Original content' });

      expect(result).toEqual(mockEnhancedContent);
      expect(mockChatService.enhance).toHaveBeenCalledWith('Original content');
    });
  });

  describe('updateCallDetails', () => {
    it('should update call details', async () => {
      const mockSummary = { callQuality: 5, tags: ['urgent'] };
      mockChatService.updateCallDetails.mockResolvedValue(mockChat);

      const result = await controller.updateCallDetails(1, {
        summary: mockSummary,
      });

      expect(result).toEqual(mockChat);
      expect(mockChatService.updateCallDetails).toHaveBeenCalledWith(
        1,
        mockSummary,
      );
    });
  });

  describe('getChatSummary', () => {
    it('should return chat summary', async () => {
      const mockSummary = { callQuality: 5, tags: ['urgent'] };
      mockChatService.generateSummary.mockResolvedValue(mockSummary);

      const result = await controller.getChatSummary(1);

      expect(result).toEqual(mockSummary);
      expect(mockChatService.generateSummary).toHaveBeenCalledWith(1);
    });
  });

  describe('getChatSummaryForMessage', () => {
    it('should return summary for message', async () => {
      const mockMessageRequests = [
        { role: UserRole.CLIENT, content: 'Hello', start_time: 0, end_time: 5 },
      ];
      const mockSummary = { callQuality: 5 };

      mockChatService.generateSummaryForMessage.mockResolvedValue(mockSummary);

      const result = await controller.getChatSummaryForMessage({
        messageRequests: mockMessageRequests,
      });

      expect(result).toEqual(mockSummary);
      expect(mockChatService.generateSummaryForMessage).toHaveBeenCalledWith(
        mockMessageRequests,
      );
    });
  });

  describe('getChatNudge', () => {
    it('should return chat nudge', async () => {
      const mockNudge = { nudge: 'Ask about feelings', stage: 'exploration' };
      const mockMessageRequests = [
        { role: UserRole.CLIENT, content: 'Hello', start_time: 0, end_time: 5 },
      ];

      mockChatService.getNudge.mockResolvedValue(mockNudge);

      const result = await controller.getChatNudge({
        newMessage: 'I feel sad',
        chatHistory: mockMessageRequests,
      });

      expect(result).toEqual(mockNudge);
      expect(mockChatService.getNudge).toHaveBeenCalledWith(
        'I feel sad',
        mockMessageRequests,
      );
    });
  });

  describe('exportSummary', () => {
    it('should export chat summary', async () => {
      const mockSummary = 'Chat summary content';
      const mockFileName = 'chat-1-summary';
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        links: jest.fn(),
        json: jest.fn(),
        end: jest.fn(),
        cookie: jest.fn(),
        clearCookie: jest.fn(),
        download: jest.fn(),
        format: jest.fn(),
        get: jest.fn(),
        header: jest.fn(),
        locals: {},
        location: jest.fn(),
        redirect: jest.fn(),
        render: jest.fn(),
        sendFile: jest.fn(),
        type: jest.fn(),
        vary: jest.fn(),
        app: {} as any,
        req: {} as any,
        res: {} as any,
        next: jest.fn(),
      } as any;

      mockChatSummaryService.exportSummary.mockResolvedValue({
        summary: mockSummary,
        fileName: mockFileName,
      });

      await controller.exportSummary(1, mockTokenUser, mockResponse);

      expect(mockChatSummaryService.exportSummary).toHaveBeenCalledWith(
        mockTokenUser,
        1,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename=${mockFileName}.txt`,
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockSummary);
    });
  });

  describe('updateCallInfo', () => {
    it('should update call info', async () => {
      const callInfoDto: CallInfoDto = {
        summaryName: 'Updated Summary Name',
      };

      mockChatService.updateCallInfo.mockResolvedValue(mockChat);

      const result = await controller.updateCallInfo(1, callInfoDto);

      expect(result).toEqual(mockChat);
      expect(mockChatService.updateCallInfo).toHaveBeenCalledWith(
        1,
        callInfoDto,
      );
    });
  });

  describe('tagPositivityRatings', () => {
    it('should return tag positivity ratings', async () => {
      const mockRatings = [
        { tag: 'urgent', positivity_rating: 0.2 },
        { tag: 'positive', positivity_rating: 0.8 },
      ];

      mockChatService.tagPositivityRatings.mockResolvedValue(mockRatings);

      const result = await controller.tagPositivityRatings({
        tags: ['urgent', 'positive'],
      });

      expect(result).toEqual(mockRatings);
      expect(mockChatService.tagPositivityRatings).toHaveBeenCalledWith([
        'urgent',
        'positive',
      ]);
    });
  });

  describe('addNoteToChat', () => {
    it('should add note to chat', async () => {
      const addNoteDto: AddNoteDto = {
        content: 'Important note about the session',
      };
      const mockResponse = { notes: 'Important note about the session' };

      mockChatService.addNoteToSession.mockResolvedValue(mockResponse);

      const result = await controller.addNoteToChat(1, addNoteDto);

      expect(result).toEqual(mockResponse);
      expect(mockChatService.addNoteToSession).toHaveBeenCalledWith(
        1,
        addNoteDto,
      );
    });
  });

  describe('addFeedbackToChat', () => {
    it('should add feedback to chat', async () => {
      const summaryFeedbackDto: SummaryFeedbackDto = {
        rating: 5,
        feedback: {
          comment: 'Great session',
          issues: ['anxiety', 'stress'],
        },
      };
      const mockResponse = {
        message: 'Feedback added successfully',
        feedback: { id: 1, rating: 5, feedback: 'Great session' },
      };

      mockChatService.addFeedbackToChat.mockResolvedValue(mockResponse);

      const result = await controller.addFeedbackToChat(1, summaryFeedbackDto);

      expect(result).toEqual(mockResponse);
      expect(mockChatService.addFeedbackToChat).toHaveBeenCalledWith(
        1,
        summaryFeedbackDto,
      );
    });
  });
});
