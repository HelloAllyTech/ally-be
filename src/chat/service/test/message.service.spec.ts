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
import { Feedback } from 'src/chat/entity/feedback.entity';

describe('MessageService', () => {
  let service: MessageService;
  let messageRepository: MessageRepository;
  let cryptoService: CryptoService;
  let permissionValidator: PermissionValidator;
  let mockAuditLogger: any;

  const mockMessage: Message = {
    id: 1,
    chatId: 1,
    senderId: 100,
    content: 'Test message',
    type: MessageType.TEXT,
    context: undefined,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
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

  const createMockQueryBuilder = () => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndMapOne: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(async () => {
    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');

    // Mock AuditLoggerService - must be done before module creation
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
            create: jest.fn((data) => ({ ...data, id: 1 })),
            save: jest.fn((message) => Promise.resolve(message)),
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            findOne: jest.fn(),
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
    messageRepository = module.get<MessageRepository>(MessageRepository);
    cryptoService = module.get<CryptoService>(CryptoService);
    permissionValidator = module.get<PermissionValidator>(PermissionValidator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessageByChatId', () => {
    it('should get messages with default sorting', async () => {
      const mockMessages = [mockEncryptedMessage];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockMessages, 1]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getMessageByChatId(1);

      expect(messageRepository.createQueryBuilder).toHaveBeenCalledWith(
        'message',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.chatId = :chatId',
        { chatId: 1 },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.tenantId = :tenantId',
        { tenantId: 'test-tenant' },
      );
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Test message');
      expect(result.count).toBe(1);
    });

    it('should apply filters when provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getMessageByChatId(1, {
        type: MessageType.NUDGE,
        limit: 10,
        offset: 5,
        sortBy: 'id',
        order: 'ASC',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.type = :type',
        { type: MessageType.NUDGE },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.id',
        'ASC',
      );
    });

    it('should use custom entity manager when provided', async () => {
      const mockEntityManager = {
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
        })),
      };

      await service.getMessageByChatId(1, {}, mockEntityManager as any);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Message);
    });

    it('should decrypt messages', async () => {
      const mockMessages = [mockEncryptedMessage];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockMessages, 1]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getMessageByChatId(1);

      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        'encrypted_Test message',
        'test-key',
      );
      expect(result.messages[0].content).toBe('Test message');
    });

    it('should join feedback data', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getMessageByChatId(1);

      expect(mockQueryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'message.feedback',
        Feedback,
        'feedback',
        'feedback.messageId = message.id',
      );
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
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockMessages, 1]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

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
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockMessages, 1]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      const result = await service.getMessages(1, 999, mockChat, {});

      expect(permissionValidator.validatePermissions).toHaveBeenCalledWith(
        999,
        [PERMISSIONS.VIEW_MESSAGES],
      );
      expect(result.data).toBeDefined();
    });

    it('should throw error for unauthorized user', async () => {
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      await expect(service.getMessages(1, 999, mockChat, {})).rejects.toThrow(
        HttpException,
      );
      await expect(service.getMessages(1, 999, mockChat, {})).rejects.toThrow(
        'You are not authorized to access this chat',
      );
    });

    it('should use default pagination values', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      await service.getMessages(1, 100, mockChat, {});

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      // offset(0) won't be called because 0 is falsy
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
    });

    it('should filter only TEXT messages', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(true);

      await service.getMessages(1, 100, mockChat, {});

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.type = :type',
        { type: MessageType.TEXT },
      );
    });

    it('should allow counselor to access messages', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);
      jest
        .spyOn(permissionValidator, 'validatePermissions')
        .mockResolvedValue(false);

      const result = await service.getMessages(1, 200, mockChat, {});

      expect(result).toBeDefined();
    });
  });

  describe('getChatHistoryForAIService', () => {
    it('should get chat history with default sorting', async () => {
      const mockMessages = [
        {
          ...mockEncryptedMessage,
          sender: { id: 100, role: UserRole.CLIENT },
        },
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getChatHistoryForAIService(1);

      expect(messageRepository.createQueryBuilder).toHaveBeenCalledWith(
        'message',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'message.chatId = :chatId',
        { chatId: 1 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'message.type = :type',
        { type: MessageType.TEXT },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.createdAt',
        'DESC',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: UserRole.CLIENT,
        content: 'Test message',
        start_time: undefined,
        end_time: undefined,
      });
    });

    it('should apply pagination when provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getChatHistoryForAIService(1, {
        limit: 10,
        offset: 5,
      });

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(5);
    });

    it('should apply custom sorting when provided', async () => {
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([]);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getChatHistoryForAIService(1, {
        sortBy: 'id',
        order: 'ASC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'message.id',
        'ASC',
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
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

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
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

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
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockMessages);

      jest
        .spyOn(messageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

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
