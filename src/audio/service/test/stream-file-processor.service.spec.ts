// CRITICAL: Mock bcrypt FIRST to prevent import issues
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

// CRITICAL: Mock @nestjs/typeorm FIRST
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: jest.fn(() => jest.fn()),
  getRepositoryToken: jest.fn((entity) => `${entity}Repository`),
  TypeOrmModule: {
    forRoot: jest.fn(),
    forFeature: jest.fn(),
  },
}));

// Mock entity files that are actually imported - adjust paths based on your project structure
jest.mock('../../../common/entities/base.entity', () => ({
  BaseEntity: class BaseEntity {
    createdAt?: Date;
    updatedAt?: Date;
  },
}));

jest.mock('../../../common/entities/chat.entity', () => ({
  ChatStatus: {
    STARTED: 'STARTED',
    ENDED: 'ENDED',
    CANCELLED: 'CANCELLED',
    PENDING: 'PENDING',
  },
  ChatSummaryStatus: {
    NO_AUDIO: 'NO_AUDIO',
    FAILED: 'FAILED',
    PENDING: 'PENDING',
    SUCCESS: 'SUCCESS',
  },
  Chat: class Chat {},
}));

jest.mock('../../../common/entities/chat-audio-uploads.entity', () => ({
  ChatAudioUploadStatus: {
    PENDING: 'PENDING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
  },
  ChatAudioUploads: class ChatAudioUploads {},
}));

// Mock TypeORM with decorators and Repository
jest.mock('typeorm', () => {
  const dualDecorator = (maybeOpts?: any) => {
    if (typeof maybeOpts === 'function') {
      return undefined;
    }
    return () => {}; // Fixed: removed unused _args parameter
  };

  class FakeEntityManager {}
  class FakeDataSource {
    transaction = jest.fn(async (cb: any) => cb(new FakeEntityManager()));
  }
  class FakeRepository {}
  class FakeBaseEntity {
    createdAt?: Date;
    updatedAt?: Date;
  }

  return {
    // Decorators
    Entity: dualDecorator,
    ChildEntity: dualDecorator,
    ViewEntity: dualDecorator,
    Column: dualDecorator,
    PrimaryColumn: dualDecorator,
    PrimaryGeneratedColumn: dualDecorator,
    ManyToOne: dualDecorator,
    OneToMany: dualDecorator,
    OneToOne: dualDecorator,
    ManyToMany: dualDecorator,
    JoinColumn: dualDecorator,
    JoinTable: dualDecorator,
    Index: dualDecorator,
    Unique: dualDecorator,
    CreateDateColumn: dualDecorator,
    UpdateDateColumn: dualDecorator,
    DeleteDateColumn: dualDecorator,
    VersionColumn: dualDecorator,
    // Classes
    DataSource: FakeDataSource,
    EntityManager: FakeEntityManager,
    Repository: FakeRepository,
    BaseEntity: FakeBaseEntity,
  };
});

// Mock fs to satisfy AWS SDK dependencies
jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
  createWriteStream: jest.fn(),
  createReadStream: jest.fn(),
}));

// Prevent path-scurry/glob loading
jest.mock('path-scurry', () => ({ PathScurry: jest.fn() }));
jest.mock('glob', () => ({ glob: jest.fn() }));

// Mock AudioEncryptionUtil with explicit factory
jest.mock('../../utils/audio-encryption.util', () => ({
  AudioEncryptionUtil: {
    createEncryptionStream: jest.fn(() => ({
      cipher: { write: jest.fn(), end: jest.fn() },
      writeStream: { end: jest.fn() },
      key: Buffer.from('key'),
      iv: Buffer.from('iv'),
    })),
    finalizeEncryption: jest.fn(async () => ({
      tag: Buffer.from('tag'),
      iv: Buffer.from('iv'),
      key: Buffer.from('key'),
    })),
    decryptToBuffer: jest.fn(async () => Buffer.from('decrypted')),
  },
}));

// Mock other services
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    })),
  },
}));

jest.mock('../../../audit/service/audit-logger.service', () => ({
  AuditLoggerService: {
    getInstance: jest.fn(() => ({
      log: jest.fn(),
    })),
  },
}));

jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    setAuthContext: jest.fn(),
  },
}));

// NOW import everything
import { Test, TestingModule } from '@nestjs/testing';
import { StreamFileProcessorService } from '../stream-file-processor.service';
import { S3Service } from '../../../aws/service/s3.service';
import { ChatAudioUploadsService } from '../chat-audio-uploads.service';
import { DataSource, EntityManager } from 'typeorm';
import { BroadcastMessageService } from '../broadcast-message.service';
import { ChatService } from '../../../chat/service/chat.service';
import { AppConfigService } from '../../../config/config.service';
import { AiEventService } from '../../../ai/service/ai-event.service';
import { AudioEncryptionUtil } from '../../utils/audio-encryption.util';
import { UserChatSessionData } from '../../../chat/type/chat.type';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import {
  ChatStatus,
  ChatSummaryStatus,
} from '../../../common/entities/chat.entity';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../../common/constants/user.constants';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { Writable } from 'stream';

// Mock WriteStream class - Fixed: proper function typing
class MockWriteStream extends Writable {
  _write(_chunk: any, _enc: string, cb: () => void) {
    cb();
  }
  end(cb?: () => void) {
    if (cb) cb();
    return this;
  }
}

describe('StreamFileProcessorService', () => {
  let service: StreamFileProcessorService;
  let s3Service: jest.Mocked<S3Service>;
  let chatAudioUploadsService: jest.Mocked<ChatAudioUploadsService>;
  let dataSource: jest.Mocked<DataSource>;
  let chatService: jest.Mocked<ChatService>;
  let aiEventService: jest.Mocked<AiEventService>;

  const mockSession: UserChatSessionData = {
    id: 'session-123',
    userId: 101,
    role: UserRole.CLIENT,
    tenantId: '1',
    provider: AudioChatProvider.MICROPHONE,
    type: 'user',
    user: undefined,
    room: '',
    chatId: 0,
  };

  const mockChat = {
    id: 555,
    counselorId: 99,
    status: ChatStatus.STARTED,
    provider: AudioChatProvider.MICROPHONE,
    createdBy: 99,
    tenantId: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamFileProcessorService,
        {
          provide: S3Service,
          useValue: {
            createMultipartUpload: jest.fn(),
            uploadPart: jest.fn(),
            completeMultipartUploadWithParts: jest.fn(),
            abortMultipartUpload: jest.fn(),
            uploadStream: jest.fn(),
            generatePresignedUrl: jest.fn(),
          },
        },
        {
          provide: ChatAudioUploadsService,
          useValue: {
            createAudioUpload: jest.fn(),
            updateAudioUpload: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
          },
        },
        {
          provide: BroadcastMessageService,
          useValue: {
            broadcastUserJoinedMessage: jest.fn(),
            broadcastAudioStreamMessage: jest.fn(),
          },
        },
        {
          provide: ChatService,
          useValue: {
            createChatForAnonymousClient: jest.fn(),
            updateChat: jest.fn(),
            updateCallMetadata: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            s3: { audioBucket: 'test-bucket' },
            audioStorage: { dir: '/tmp/audio' },
          },
        },
        {
          provide: AiEventService,
          useValue: { publishTranscribeAudioEvent: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(StreamFileProcessorService);
    s3Service = module.get(S3Service);
    chatAudioUploadsService = module.get(ChatAudioUploadsService);
    dataSource = module.get(DataSource);
    chatService = module.get(ChatService);
    aiEventService = module.get(AiEventService);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addToPendingAudioQueue and processPendingAudioQueue', () => {
    it('should add and process audio buffers', () => {
      const id = 'c1';
      const b1 = Buffer.from('a');
      const b2 = Buffer.from('b');

      service.addToPendingAudioQueue(id, b1);
      service.addToPendingAudioQueue(id, b2);
      expect(service['pendingAudioQueue'][id]).toHaveLength(2);

      const out = service.processPendingAudioQueue(id, Buffer.from('c'));
      expect(out.toString()).toBe('abc');
      expect(service['pendingAudioQueue'][id]).toBeUndefined();
    });

    it('should return buffer if no pending', () => {
      const id = 'c2';
      const buffer = Buffer.from('x');
      const result = service.processPendingAudioQueue(id, buffer);
      expect(result).toBe(buffer);
    });
  });

  describe('clearPendingAudioQueue', () => {
    it('should clear pending audio queue', () => {
      service['pendingAudioQueue']['call-1'] = [Buffer.from('z')];
      service.clearPendingAudioQueue('call-1');
      expect(service['pendingAudioQueue']['call-1']).toBeUndefined();
    });
  });

  describe('setAuthContext', () => {
    it('should call ExecutionManager.setAuthContext', () => {
      service.setAuthContext(mockSession);
      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        mockSession.userId.toString(),
        mockSession.tenantId,
      );
    });
  });

  describe('startCallStream', () => {
    const chatData = {
      counselorId: 99,
      provider: AudioChatProvider.MICROPHONE,
      platform: AudioChatPlatform.WEB,
      sampleRate: 16000,
    };

    it('should create chat and setup call stream', async () => {
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (runInTx: any) => runInTx({} as EntityManager),
      );

      (AudioEncryptionUtil.createEncryptionStream as jest.Mock)
        .mockReturnValueOnce({
          cipher: { write: jest.fn(), end: jest.fn() },
          writeStream: new MockWriteStream(),
          key: Buffer.from('k1'),
          iv: Buffer.from('iv1'),
        })
        .mockReturnValueOnce({
          cipher: { write: jest.fn(), end: jest.fn() },
          writeStream: new MockWriteStream(),
          key: Buffer.from('k2'),
          iv: Buffer.from('iv2'),
        });

      chatService.createChatForAnonymousClient.mockResolvedValue(
        mockChat as any,
      );
      s3Service.createMultipartUpload.mockResolvedValue({
        UploadId: 'up-1',
      } as any);
      chatAudioUploadsService.createAudioUpload.mockResolvedValue(
        undefined as any,
      );

      const onChatCreated = jest.fn();
      await service.startCallStream(mockSession, chatData, onChatCreated);

      expect(chatService.createChatForAnonymousClient).toHaveBeenCalled();
      expect(s3Service.createMultipartUpload).toHaveBeenCalled();
      expect(onChatCreated).toHaveBeenCalledWith(mockChat.id);
      expect(service['activeCallStreams'][mockChat.id]).toBeDefined();
    });

    it('should rollback on error', async () => {
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('Transaction failed');
      });

      await expect(
        service.startCallStream(mockSession, chatData, jest.fn()),
      ).rejects.toThrow('Transaction failed');
    });
  });

  describe('saveAudio', () => {
    const audioBase64 = Buffer.from('hello').toString('base64');

    it('should queue audio if placeholder chatId', () => {
      service.saveAudio(mockSession, {
        chatId: PLACEHOLDER_CHAT_ID,
        audioBase64,
      });
      expect(service['pendingAudioQueue'][mockSession.id]).toBeDefined();
    });

    it('should write to active stream', () => {
      const cipher = { write: jest.fn() } as any;
      const chatId = mockChat.id;

      service['activeCallStreams'][chatId] = {
        parts: [],
        uploadId: 'up-2',
        key: 'key-2',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            cipher,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k'),
            iv: Buffer.from('iv'),
            tempFilePath: '/tmp/a',
            bufferSize: 0,
          },
          {
            cipher,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k2'),
            iv: Buffer.from('iv2'),
            tempFilePath: '/tmp/b',
            bufferSize: 0,
          },
        ],
        callId: mockSession.id,
        chatId: chatId,
      };

      service.saveAudio(mockSession, { chatId, audioBase64 });
      expect(cipher.write).toHaveBeenCalled();
    });
  });

  describe('endCallStream', () => {
    it('should handle missing stream gracefully', async () => {
      await service.endCallStream({ chatId: 999 });
    });

    it('should complete multipart upload when parts exist', async () => {
      const chatId = mockChat.id;
      service['activeCallStreams'][chatId] = {
        parts: [{ ETag: 'E', PartNumber: 1 }],
        uploadId: 'up-5',
        key: 'key-5',
        partNumber: 2,
        currentFileIndex: 0,
        files: [
          {
            cipher: {} as any,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k'),
            iv: Buffer.from('iv'),
            tempFilePath: '/tmp/a',
            bufferSize: 10,
          },
          {
            cipher: {} as any,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k2'),
            iv: Buffer.from('iv2'),
            tempFilePath: '/tmp/b',
            bufferSize: 0,
          },
        ],
        callId: mockSession.id,
        chatId: chatId,
      };

      jest
        .spyOn(service as any, 'flushFileAsPart')
        .mockResolvedValue(undefined);
      s3Service.completeMultipartUploadWithParts.mockResolvedValue(
        undefined as any,
      );
      chatAudioUploadsService.updateAudioUpload.mockResolvedValue({
        sampleRate: 16000,
      } as any);
      s3Service.generatePresignedUrl.mockResolvedValue('https://audio');
      aiEventService.publishTranscribeAudioEvent.mockResolvedValue(
        undefined as any,
      );

      await service.endCallStream({ chatId });

      expect(s3Service.completeMultipartUploadWithParts).toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalled();
    });

    it('should handle empty file case', async () => {
      const chatId = mockChat.id;
      service['activeCallStreams'][chatId] = {
        parts: [],
        uploadId: 'up-6',
        key: 'key-6',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            cipher: {} as any,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k'),
            iv: Buffer.from('iv'),
            tempFilePath: '/tmp/a',
            bufferSize: 0,
          },
          {
            cipher: {} as any,
            writeStream: new MockWriteStream() as any,
            encryptionKey: Buffer.from('k2'),
            iv: Buffer.from('iv2'),
            tempFilePath: '/tmp/b',
            bufferSize: 0,
          },
        ],
        callId: mockSession.id,
        chatId: chatId,
      };

      s3Service.abortMultipartUpload.mockResolvedValue(undefined as any);
      chatService.updateCallMetadata.mockResolvedValue(undefined as any);
      chatService.updateChat.mockResolvedValue(undefined as any);
      chatAudioUploadsService.updateAudioUpload.mockResolvedValue(
        undefined as any,
      );

      await service.endCallStream({ chatId });

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.NO_AUDIO,
      });
    });
  });
});
