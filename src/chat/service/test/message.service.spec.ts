import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { MessageService } from '../message.service';
import { MessageRepository } from '../../repository/message.repository';
import { CryptoService } from '../../../common/service/crypto.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { AppConfigService } from '../../../config/config.service';
import { AuditLoggerService } from '../../../audit/service/audit-logger.service';
import { PermissionValidator } from '../../../authorization/service/permission-validator.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { AUDIT_EVENTS } from '../../../audit/constants/audit-event.constants';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { ANONYMOUS_CLIENT_ID } from '../../../common/constants/user.constants';
import { UserRole } from '../../../common/constants/user.constants';
import { Message, MessageType } from 'src/chat/entity/message.entity';

describe('MessageService', () => {
  let service: MessageService;
  let messageRepository: jest.Mocked<MessageRepository>;
  let cryptoService: jest.Mocked<CryptoService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let mockAuditLogger: any;

  const mockTenantId = 'test-tenant';

  const mockMessage: Message = {
    id: 1,
    chatId: 1,
    senderId: 100,
    content: 'Test message',
    type: MessageType.TEXT,
    context: undefined,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date(),
    tenantId: mockTenantId,
    parentMessageId: undefined,
    startSeconds: undefined,
    endSeconds: undefined,
  };

  const mockEncryptedMessage = {
    ...mockMessage,
    content: 'encrypted_Test message',
  };

  const mockChat = {
    clientId: 100,
    counselorId: 200,
  };

  beforeEach(async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(mockTenantId);

    mockAuditLogger = {
      log: jest.fn(),
    };
    jest
      .spyOn(AuditLoggerService, 'getInstance')
      .mockReturnValue(mockAuditLogger as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        {
          provide: MessageRepository,
          useValue: {
            getMessagesByChatIdQuery: jest.fn(),
            getChatHistoryQuery: jest.fn(),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn((data) => Promise.resolve(`encrypted_${data}`)),
            decrypt: jest.fn((data) =>
              Promise.resolve(data.replace('encrypted_', '')),
            ),
          },
        },
        {
          provide: MessageBrokerService,
          useValue: {
            publish: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            phiData: {
              phiDataEncryptionKey: 'test-key',
            },
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
    messageRepository = module.get(MessageRepository);
    cryptoService = module.get(CryptoService);
    permissionValidator = module.get(PermissionValidator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessageByChatId', () => {
    it('should get messages and decrypt them', async () => {
      const mockMessages = [mockEncryptedMessage];
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: mockMessages as any,
        count: 1,
      });

      const result = await service.getMessageByChatId(1);

      expect(messageRepository.getMessagesByChatIdQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        undefined,
        undefined,
      );
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Test message');
      expect(result.count).toBe(1);
    });

    it('should pass filters to repository', async () => {
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: [],
        count: 0,
      });

      const filter = {
        type: MessageType.NUDGE,
        limit: 10,
        offset: 5,
        sortBy: 'id',
        order: 'ASC' as const,
      };

      await service.getMessageByChatId(1, filter);

      expect(messageRepository.getMessagesByChatIdQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        filter,
        undefined,
      );
    });

    it('should pass entity manager to repository', async () => {
      const mockEntityManager = {} as any;
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: [],
        count: 0,
      });

      await service.getMessageByChatId(1, {}, mockEntityManager);

      expect(messageRepository.getMessagesByChatIdQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        {},
        mockEntityManager,
      );
    });

    it('should decrypt messages', async () => {
      const mockMessages = [mockEncryptedMessage];
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: mockMessages as any,
        count: 1,
      });

      const result = await service.getMessageByChatId(1);

      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        'encrypted_Test message',
        'test-key',
      );
      expect(result.messages[0].content).toBe('Test message');
    });
  });

  describe('formatMessage', () => {
    it('should format a message correctly', () => {
      const messageWithFeedback = {
        ...mockMessage,
        feedback: {
          id: 1,
          messageId: 1,
          rating: 5,
          feedback: 'Great',
        },
      };

      const result = service.formatMessage(messageWithFeedback as any);

      expect(result).toEqual({
        messageId: 1,
        chatId: 1,
        senderId: 100,
        messageType: MessageType.TEXT,
        content: 'Test message',
        context: undefined,
        createdAt: '2024-01-01T10:00:00.000Z',
        feedback: messageWithFeedback.feedback,
        startSeconds: undefined,
        endSeconds: undefined,
      });
    });

    it('should format message with time ranges', () => {
      const messageWithTime = {
        ...mockMessage,
        startSeconds: 10,
        endSeconds: 20,
      };

      const result = service.formatMessage(messageWithTime as any);

      expect(result.startSeconds).toBe(10);
      expect(result.endSeconds).toBe(20);
    });
  });

  describe('getMessages', () => {
    it('should get messages for authorized user (participant)', async () => {
      const mockMessages = [mockMessage];
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: mockMessages as any,
        count: 1,
      });
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const result = await service.getMessages(1, 100, mockChat, {
        limit: 10,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(mockAuditLogger.log).toHaveBeenCalledWith({
        eventType: AUDIT_EVENTS.ACCESS_TRANSCRIPT,
        details: {
          chatId: '1',
        },
      });
    });

    it('should get messages for user with VIEW_MESSAGES permission', async () => {
      const mockMessages = [mockMessage];
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: mockMessages as any,
        count: 1,
      });
      permissionValidator.validatePermissions.mockResolvedValue(true);

      const result = await service.getMessages(1, 999, mockChat, {});

      expect(permissionValidator.validatePermissions).toHaveBeenCalledWith(
        999,
        [PERMISSIONS.VIEW_MESSAGES],
      );
      expect(result.data).toBeDefined();
    });

    it('should throw error for unauthorized user', async () => {
      permissionValidator.validatePermissions.mockResolvedValue(false);

      await expect(service.getMessages(1, 999, mockChat, {})).rejects.toThrow(
        HttpException,
      );
      await expect(service.getMessages(1, 999, mockChat, {})).rejects.toThrow(
        'You are not authorized to access this chat',
      );
    });

    it('should use default pagination values', async () => {
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: [],
        count: 0,
      });
      permissionValidator.validatePermissions.mockResolvedValue(true);

      await service.getMessages(1, 100, mockChat, {});

      expect(messageRepository.getMessagesByChatIdQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        {
          limit: 10,
          offset: 0,
          sortBy: 'createdAt',
          order: 'DESC',
          type: MessageType.TEXT,
        },
        undefined,
      );
    });

    it('should filter only TEXT messages', async () => {
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: [],
        count: 0,
      });
      permissionValidator.validatePermissions.mockResolvedValue(true);

      await service.getMessages(1, 100, mockChat, {});

      expect(messageRepository.getMessagesByChatIdQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        expect.objectContaining({ type: MessageType.TEXT }),
        undefined,
      );
    });

    it('should allow counselor to access messages', async () => {
      messageRepository.getMessagesByChatIdQuery.mockResolvedValue({
        messages: [],
        count: 0,
      });
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const result = await service.getMessages(1, 200, mockChat, {});

      expect(result).toBeDefined();
    });
  });

  describe('getChatHistoryForAIService', () => {
    it('should get chat history and transform to message requests', async () => {
      const mockMessages = [
        {
          ...mockEncryptedMessage,
          sender: { id: 100, role: UserRole.CLIENT },
        },
      ];
      messageRepository.getChatHistoryQuery.mockResolvedValue(
        mockMessages as any,
      );

      const result = await service.getChatHistoryForAIService(1);

      expect(messageRepository.getChatHistoryQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        undefined,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: UserRole.CLIENT,
        content: 'Test message',
        start_time: undefined,
        end_time: undefined,
      });
    });

    it('should pass pagination to repository', async () => {
      messageRepository.getChatHistoryQuery.mockResolvedValue([]);

      await service.getChatHistoryForAIService(1, {
        limit: 10,
        offset: 5,
        sortBy: 'id',
        order: 'ASC',
      });

      expect(messageRepository.getChatHistoryQuery).toHaveBeenCalledWith(
        1,
        mockTenantId,
        {
          limit: 10,
          offset: 5,
          sortBy: 'id',
          order: 'ASC',
        },
      );
    });

    it('should handle anonymous client messages', async () => {
      const mockMessages = [
        {
          ...mockEncryptedMessage,
          senderId: ANONYMOUS_CLIENT_ID,
          sender: null,
        },
      ];
      messageRepository.getChatHistoryQuery.mockResolvedValue(
        mockMessages as any,
      );

      const result = await service.getChatHistoryForAIService(1);

      expect(result[0].role).toBe('CLIENT');
    });

    it('should include time ranges in message requests', async () => {
      const mockMessages = [
        {
          ...mockEncryptedMessage,
          sender: { id: 100, role: UserRole.CLIENT },
          startSeconds: 10,
          endSeconds: 20,
        },
      ];
      messageRepository.getChatHistoryQuery.mockResolvedValue(
        mockMessages as any,
      );

      const result = await service.getChatHistoryForAIService(1);

      expect(result[0].start_time).toBe(10);
      expect(result[0].end_time).toBe(20);
    });

    it('should decrypt messages', async () => {
      const mockMessages = [
        {
          ...mockEncryptedMessage,
          sender: { id: 100, role: UserRole.CLIENT },
        },
      ];
      messageRepository.getChatHistoryQuery.mockResolvedValue(
        mockMessages as any,
      );

      const result = await service.getChatHistoryForAIService(1);

      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        'encrypted_Test message',
        'test-key',
      );
      expect(result[0].content).toBe('Test message');
    });
  });

  describe('decryptMessages (private)', () => {
    it('should decrypt multiple messages', async () => {
      const encryptedMessages = [
        mockEncryptedMessage,
        {
          ...mockEncryptedMessage,
          id: 2,
          content: 'encrypted_Another message',
        },
      ];

      const result = await service['decryptMessages'](encryptedMessages);

      expect(cryptoService.decrypt).toHaveBeenCalledTimes(2);
      expect(result[0].content).toBe('Test message');
      expect(result[1].content).toBe('Another message');
    });

    it('should handle empty array', async () => {
      const result = await service['decryptMessages']([]);

      expect(result).toEqual([]);
      expect(cryptoService.decrypt).not.toHaveBeenCalled();
    });

    it('should preserve all message properties', async () => {
      const encryptedMessages = [mockEncryptedMessage];

      const result = await service['decryptMessages'](encryptedMessages);

      expect(result[0]).toEqual({
        ...mockMessage,
      });
    });
  });
});
