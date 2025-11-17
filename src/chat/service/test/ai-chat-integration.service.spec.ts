import { Test, TestingModule } from '@nestjs/testing';
import { AiChatIntegrationService } from '../ai-chat-integration.service';
import { AiService } from '../../../ai/service/ai.service';
import { SettingsService } from '../../../settings/service/settings.service';
import { MessageService } from '../message.service';
import { CallDetailsService } from '../call-details.service';
import { AuditLoggerService } from '../../../audit/service/audit-logger.service';
import { AUDIT_EVENTS } from '../../../audit/constants/audit-event.constants';
import { ChatEvents } from '../../constants/chat.constants';
import { UserRole } from '../../../common/constants/user.constants';
import { MessageRequest } from '../../../ai/dto/ai.request.dto';
import { MessageType } from 'src/chat/entity/message.entity';

describe('AiChatIntegrationService', () => {
  let service: AiChatIntegrationService;
  let aiService: AiService;
  let settingsService: SettingsService;
  let messageService: MessageService;
  let callDetailsService: CallDetailsService;
  let mockAuditLogger: any;

  const mockSession = {
    id: '1',
    type: 'user' as const,
    user: null,
    room: 'test-room',
    chatId: 1,
    userId: 100,
    role: UserRole.CLIENT,
    tenantId: 'test-tenant',
  };

  const mockParentMessage = {
    content: 'Test message',
    chatId: 1,
    id: 123,
  };

  const mockChannel = 'test-channel';

  beforeEach(async () => {
    // Mock AuditLoggerService
    mockAuditLogger = {
      log: jest.fn(),
    };
    jest
      .spyOn(AuditLoggerService, 'getInstance')
      .mockReturnValue(mockAuditLogger as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatIntegrationService,
        {
          provide: AiService,
          useValue: {
            enhance: jest.fn(),
            getNudge: jest.fn(),
            generateTagPositivityRatings: jest.fn(),
            generateSummaryAndTags: jest.fn(),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getNudgeStatus: jest.fn(),
          },
        },
        {
          provide: MessageService,
          useValue: {
            getChatHistoryForAIService: jest.fn(),
          },
        },
        {
          provide: CallDetailsService,
          useValue: {
            isChatPaused: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiChatIntegrationService>(AiChatIntegrationService);
    aiService = module.get<AiService>(AiService);
    settingsService = module.get<SettingsService>(SettingsService);
    messageService = module.get<MessageService>(MessageService);
    callDetailsService = module.get<CallDetailsService>(CallDetailsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enhance', () => {
    it('should enhance summary using AI service', async () => {
      const originalSummary = 'Original summary';
      const enhancedResponse = {
        enhanced_content: 'Enhanced summary',
      };

      jest.spyOn(aiService, 'enhance').mockResolvedValue(enhancedResponse);

      const result = await service.enhance(originalSummary);

      expect(aiService.enhance).toHaveBeenCalledWith(originalSummary);
      expect(result).toEqual(enhancedResponse);
    });
  });

  describe('getNudge', () => {
    it('should get nudge from AI service', async () => {
      const newMessage = 'User message';
      const messageRequests: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];
      const mockNudge = {
        nudge: 'Test nudge',
        stage: 'Assessment',
      };

      jest.spyOn(aiService, 'getNudge').mockResolvedValue(mockNudge as any);

      const result = await service.getNudge(newMessage, messageRequests);

      expect(aiService.getNudge).toHaveBeenCalledWith(
        newMessage,
        messageRequests,
      );
      expect(result).toEqual(mockNudge);
    });
  });

  describe('tagPositivityRatings', () => {
    it('should get tag positivity ratings', async () => {
      const tags = ['happy', 'sad', 'anxious'];
      const mockResponse = {
        tags: [
          { tag: 'happy', positivity_rating: 0.9 },
          { tag: 'sad', positivity_rating: 0.2 },
          { tag: 'anxious', positivity_rating: 0.3 },
        ],
      };

      jest
        .spyOn(aiService, 'generateTagPositivityRatings')
        .mockResolvedValue(mockResponse as any);

      const result = await service.tagPositivityRatings(tags);

      expect(aiService.generateTagPositivityRatings).toHaveBeenCalledWith(tags);
      expect(result).toEqual(mockResponse.tags);
    });

    it('should handle empty tags array', async () => {
      const mockResponse = {
        tags: [],
      };

      jest
        .spyOn(aiService, 'generateTagPositivityRatings')
        .mockResolvedValue(mockResponse as any);

      const result = await service.tagPositivityRatings([]);

      expect(result).toEqual([]);
    });
  });

  describe('generateSummaryForMessage', () => {
    it('should generate summary and log audit event', async () => {
      const messageRequests: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];
      const mockSummary = {
        session_summary: 'Test summary',
        tags: [{ tag: 'test', positivity_rating: 0.8 }],
        call_quality: 5,
      };

      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(mockSummary as any);

      const result = await service.generateSummaryForMessage(messageRequests);

      expect(aiService.generateSummaryAndTags).toHaveBeenCalledWith(
        messageRequests,
      );
      expect(result).toEqual(mockSummary);
      expect(mockAuditLogger.log).toHaveBeenCalledWith({
        eventType: AUDIT_EVENTS.SUMMARY_GENERATED_FROM_MESSAGES,
        details: {
          messageRequests,
        },
      });
    });

    it('should return undefined when AI service returns null', async () => {
      const messageRequests: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
      ];

      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(null as any);

      const result = await service.generateSummaryForMessage(messageRequests);

      expect(result).toBeUndefined();
      expect(mockAuditLogger.log).not.toHaveBeenCalled();
    });

    it('should return undefined when AI service returns undefined', async () => {
      const messageRequests: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
      ];

      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(undefined as any);

      const result = await service.generateSummaryForMessage(messageRequests);

      expect(result).toBeUndefined();
      expect(mockAuditLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('triggerNudge', () => {
    const onHandleNudge = jest.fn();

    beforeEach(() => {
      onHandleNudge.mockClear();
    });

    it('should not trigger nudge when chat is paused', async () => {
      jest.spyOn(callDetailsService, 'isChatPaused').mockResolvedValue(true);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);

      await service.triggerNudge(
        mockParentMessage,
        mockSession,
        1,
        mockChannel,
        onHandleNudge,
      );

      expect(callDetailsService.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).not.toHaveBeenCalled();
      expect(messageService.getChatHistoryForAIService).not.toHaveBeenCalled();
      expect(aiService.getNudge).not.toHaveBeenCalled();
    });

    it('should not trigger nudge when nudge is disabled', async () => {
      jest.spyOn(callDetailsService, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(false);

      await service.triggerNudge(
        mockParentMessage,
        mockSession,
        1,
        mockChannel,
        onHandleNudge,
      );

      expect(callDetailsService.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(messageService.getChatHistoryForAIService).not.toHaveBeenCalled();
      expect(aiService.getNudge).not.toHaveBeenCalled();
    });

    it('should trigger nudge successfully when conditions are met', async () => {
      const mockMessages: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
        { role: 'COUNSELOR', content: 'Hi there' },
      ];
      const mockNudge = {
        nudge: 'Test nudge',
        stage: 'Assessment',
      };

      jest.spyOn(callDetailsService, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(messageService, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages);
      jest.spyOn(aiService, 'getNudge').mockResolvedValue(mockNudge as any);

      await service.triggerNudge(
        mockParentMessage,
        mockSession,
        1,
        mockChannel,
        onHandleNudge,
      );

      // Wait for async promise to resolve
      await new Promise(process.nextTick);

      expect(callDetailsService.isChatPaused).toHaveBeenCalledWith(1);
      expect(settingsService.getNudgeStatus).toHaveBeenCalled();
      expect(messageService.getChatHistoryForAIService).toHaveBeenCalledWith(
        1,
        {
          sortBy: 'createdAt',
          order: 'DESC',
          limit: 4,
        },
      );
      expect(aiService.getNudge).toHaveBeenCalledWith(
        'CLIENT: Test message',
        mockMessages,
      );
      expect(onHandleNudge).toHaveBeenCalledWith(
        mockNudge,
        mockSession,
        mockParentMessage,
        mockChannel,
      );
    });

    it('should not call onHandleNudge when AI returns undefined', async () => {
      const mockMessages: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
      ];

      jest.spyOn(callDetailsService, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(messageService, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages);
      jest.spyOn(aiService, 'getNudge').mockResolvedValue(undefined as any);

      await service.triggerNudge(
        mockParentMessage,
        mockSession,
        1,
        mockChannel,
        onHandleNudge,
      );

      // Wait for async promise to resolve
      await new Promise(process.nextTick);

      expect(onHandleNudge).not.toHaveBeenCalled();
    });

    it('should handle AI service errors gracefully', async () => {
      const mockMessages: MessageRequest[] = [
        { role: 'CLIENT', content: 'Hello' },
      ];
      const mockError = new Error('AI service error');

      jest.spyOn(callDetailsService, 'isChatPaused').mockResolvedValue(false);
      jest.spyOn(settingsService, 'getNudgeStatus').mockResolvedValue(true);
      jest
        .spyOn(messageService, 'getChatHistoryForAIService')
        .mockResolvedValue(mockMessages);
      jest.spyOn(aiService, 'getNudge').mockRejectedValue(mockError);

      await service.triggerNudge(
        mockParentMessage,
        mockSession,
        1,
        mockChannel,
        onHandleNudge,
      );

      // Wait for async promise to resolve
      await new Promise(process.nextTick);

      expect(onHandleNudge).not.toHaveBeenCalled();
    });
  });

  describe('handleNudge', () => {
    const persistAndBroadcastMessage = jest.fn();

    beforeEach(() => {
      persistAndBroadcastMessage.mockClear();
    });

    it('should handle both nudge and stage', async () => {
      const nudgeResponse = {
        nudge: 'Test nudge',
        stage: 'Assessment',
      };

      persistAndBroadcastMessage.mockResolvedValue({});

      await service.handleNudge(
        nudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
        persistAndBroadcastMessage,
      );

      expect(persistAndBroadcastMessage).toHaveBeenCalledTimes(2);

      // Check nudge call
      expect(persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        {
          chatId: 1,
          content: 'Test nudge',
          messageType: MessageType.NUDGE,
          parentMessageId: 123,
        },
        {
          event: ChatEvents.NUDGE,
        },
        mockChannel,
      );

      // Check stage call
      expect(persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        {
          chatId: 1,
          content: 'Assessment',
          messageType: MessageType.STAGE,
          parentMessageId: 123,
        },
        {
          event: ChatEvents.STAGE,
        },
        mockChannel,
      );
    });

    it('should handle only nudge when stage is not provided', async () => {
      const nudgeResponse: any = {
        nudge: 'Test nudge',
        stage: undefined,
      };

      persistAndBroadcastMessage.mockResolvedValue({});

      await service.handleNudge(
        nudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
        persistAndBroadcastMessage,
      );

      expect(persistAndBroadcastMessage).toHaveBeenCalledTimes(1);
      expect(persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        expect.objectContaining({
          messageType: MessageType.NUDGE,
        }),
        expect.any(Object),
        mockChannel,
      );
    });

    it('should handle only stage when nudge is not provided', async () => {
      const nudgeResponse: any = {
        nudge: undefined,
        stage: 'Assessment',
      };

      persistAndBroadcastMessage.mockResolvedValue({});

      await service.handleNudge(
        nudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
        persistAndBroadcastMessage,
      );

      expect(persistAndBroadcastMessage).toHaveBeenCalledTimes(1);
      expect(persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        expect.objectContaining({
          messageType: MessageType.STAGE,
        }),
        expect.any(Object),
        mockChannel,
      );
    });

    it('should not call persistAndBroadcastMessage when both nudge and stage are undefined', async () => {
      const nudgeResponse: any = {
        nudge: undefined,
        stage: undefined,
      };

      persistAndBroadcastMessage.mockResolvedValue({});

      await service.handleNudge(
        nudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
        persistAndBroadcastMessage,
      );

      expect(persistAndBroadcastMessage).not.toHaveBeenCalled();
    });

    it('should handle nudge with empty string', async () => {
      const nudgeResponse: any = {
        nudge: '',
        stage: 'Assessment',
      };

      persistAndBroadcastMessage.mockResolvedValue({});

      await service.handleNudge(
        nudgeResponse,
        mockSession,
        mockParentMessage,
        mockChannel,
        persistAndBroadcastMessage,
      );

      // Empty string is falsy, so should only call for stage
      expect(persistAndBroadcastMessage).toHaveBeenCalledTimes(1);
      expect(persistAndBroadcastMessage).toHaveBeenCalledWith(
        mockSession,
        expect.objectContaining({
          messageType: MessageType.STAGE,
        }),
        expect.any(Object),
        mockChannel,
      );
    });
  });
});
