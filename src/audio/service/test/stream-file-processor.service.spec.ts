import { Test, TestingModule } from '@nestjs/testing';
import { StreamFileProcessorService } from '../stream-file-processor.service';
import { S3Service } from '../../../aws/service/s3.service';
import { ChatAudioUploadsService } from '../chat-audio-uploads.service';
import { BroadcastMessageService } from '../broadcast-message.service';
import { ChatService } from '../../../chat/service/chat.service';
import { AppConfigService } from '../../../config/config.service';
import { AiEventService } from '../../../ai/service/ai-event.service';
import { DataSource, EntityManager } from 'typeorm';
import { AudioChatProvider } from '../../../common/constants/chat.constants';
import { PLACEHOLDER_CHAT_ID } from '../../../common/constants/user.constants';

// Mock all problematic modules at the top level
jest.mock('typeorm', () => ({
  DataSource: jest.fn().mockImplementation(() => ({
    transaction: jest.fn(),
  })),
  EntityManager: jest.fn(),
  Entity: jest.fn(() => (target: any) => target),
  PrimaryGeneratedColumn: jest.fn(() => () => {}),
  Column: jest.fn(() => () => {}),
  CreateDateColumn: jest.fn(() => () => {}),
  UpdateDateColumn: jest.fn(() => () => {}),
  Index: jest.fn(() => (target: any) => target),
  BaseEntity: jest.fn(),
}));

jest.mock('@nestjs/typeorm', () => ({}));

// Mock entity files to avoid decorator issues
jest.mock('../../../common/entities/chat.entity', () => ({
  ChatSummaryStatus: {},
}));

jest.mock('../../../common/entities/chat-audio-uploads.entity', () => ({
  ChatAudioUploadStatus: {},
}));

// Mock all service dependencies
jest.mock('../../../aws/service/s3.service', () => ({
  S3Service: jest.fn(),
}));

jest.mock('../chat-audio-uploads.service', () => ({
  ChatAudioUploadsService: jest.fn(),
}));

jest.mock('../broadcast-message.service', () => ({
  BroadcastMessageService: jest.fn(),
}));

jest.mock('../../../chat/service/chat.service', () => ({
  ChatService: jest.fn(),
}));

jest.mock('../../../config/config.service', () => ({
  AppConfigService: jest.fn(),
}));

jest.mock('../../../ai/service/ai-event.service', () => ({
  AiEventService: jest.fn(),
}));

jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(() => 'tenant-123'),
    getExecutionId: jest.fn(() => 'exec-123'),
    getCurrentContext: jest.fn(() => ({ tenantId: 'tenant-123' })),
    setAuthContext: jest.fn(),
  },
}));

jest.mock('../../../common/util/chat-types.util', () => ({
  findMessageBrokerChannelUsingProvider: jest.fn(() => 'test-channel'),
}));

jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn((cb) => cb()),
  })),
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
  },
  readFileSync: jest.fn(),
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(),
  })),
}));

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((path) => path.split('/').slice(0, -1).join('/') || '.'),
  resolve: jest.fn((...args) => args.join('/')),
  basename: jest.fn((path) => path.split('/').pop() || ''),
  extname: jest.fn((path) => {
    const parts = path.split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
  }),
}));

describe('StreamFileProcessorService', () => {
  let service: StreamFileProcessorService;
  let s3Service: jest.Mocked<S3Service>;
  let chatAudioUploadsService: jest.Mocked<ChatAudioUploadsService>;
  let dataSource: jest.Mocked<DataSource>;
  let broadcastMessageService: jest.Mocked<BroadcastMessageService>;
  let chatService: jest.Mocked<ChatService>;

  const mockEntityManager = {
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  } as unknown as EntityManager;

  beforeEach(async () => {
    const mockS3Service = {
      createMultipartUpload: jest.fn(),
      uploadPart: jest.fn(),
      completeMultipartUpload: jest.fn(),
      completeMultipartUploadWithParts: jest.fn(),
      abortMultipartUpload: jest.fn(),
      uploadStream: jest.fn(),
      generatePresignedUrl: jest.fn(),
    };

    const mockChatAudioUploadsService = {
      createAudioUpload: jest.fn(),
      updateAudioUpload: jest.fn(),
      getAudioUpload: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const mockBroadcastMessageService = {
      broadcastUserJoinedMessage: jest.fn(),
      broadcastUserDisconnectedMessage: jest.fn(),
      broadcastAudioStreamMessage: jest.fn(),
      broadcastChatEndedEvent: jest.fn(),
    };

    const mockChatService = {
      createChatForAnonymousClient: jest.fn(),
      updateCallMetadata: jest.fn(),
      updateChat: jest.fn(),
    };

    const mockConfig = {
      s3: { audioBucket: 'test-bucket' },
      audioStorage: { dir: '/tmp' },
    };

    const mockAiEventService = {
      publishEvent: jest.fn(),
      publishTranscribeAudioEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamFileProcessorService,
        { provide: S3Service, useValue: mockS3Service },
        {
          provide: ChatAudioUploadsService,
          useValue: mockChatAudioUploadsService,
        },
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: BroadcastMessageService,
          useValue: mockBroadcastMessageService,
        },
        { provide: ChatService, useValue: mockChatService },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: AiEventService, useValue: mockAiEventService },
      ],
    }).compile();

    service = module.get<StreamFileProcessorService>(
      StreamFileProcessorService,
    );
    s3Service = module.get(S3Service);
    chatAudioUploadsService = module.get(ChatAudioUploadsService);
    dataSource = module.get(DataSource);
    broadcastMessageService = module.get(BroadcastMessageService);
    chatService = module.get(ChatService);

    // Setup default mocks
    (dataSource.transaction as jest.Mock).mockImplementation((callback) =>
      callback(mockEntityManager),
    );

    // Setup default S3 service mocks
    s3Service.uploadPart.mockResolvedValue({
      ETag: 'etag1',
      $metadata: {} as any,
    });
    s3Service.completeMultipartUpload.mockResolvedValue({
      $metadata: {} as any,
    });
    s3Service.abortMultipartUpload.mockResolvedValue({
      $metadata: {} as any,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addToPendingAudioQueue', () => {
    it('should add audio data to pending queue for new client', () => {
      const clientId = 'client-123';
      const audioBuffer = Buffer.from('test audio');

      service.addToPendingAudioQueue(clientId, audioBuffer);

      const pendingQueue = (service as any).pendingAudioQueue;
      expect(pendingQueue[clientId]).toEqual([audioBuffer]);
    });

    it('should add audio data to existing pending queue', () => {
      const clientId = 'client-123';
      const audioBuffer1 = Buffer.from('test audio 1');
      const audioBuffer2 = Buffer.from('test audio 2');

      service.addToPendingAudioQueue(clientId, audioBuffer1);
      service.addToPendingAudioQueue(clientId, audioBuffer2);

      const pendingQueue = (service as any).pendingAudioQueue;
      expect(pendingQueue[clientId]).toEqual([audioBuffer1, audioBuffer2]);
    });
  });

  describe('processPendingAudioQueue', () => {
    it('should return combined audio buffer when pending queue exists', () => {
      const clientId = 'client-123';
      const pendingBuffer = Buffer.from('pending audio');
      const newBuffer = Buffer.from('new audio');

      service.addToPendingAudioQueue(clientId, pendingBuffer);

      const result = service.processPendingAudioQueue(clientId, newBuffer);

      expect(result).toEqual(Buffer.concat([pendingBuffer, newBuffer]));

      const pendingQueue = (service as any).pendingAudioQueue;
      expect(pendingQueue[clientId]).toBeUndefined();
    });

    it('should return new buffer when no pending queue exists', () => {
      const clientId = 'client-123';
      const newBuffer = Buffer.from('new audio');

      const result = service.processPendingAudioQueue(clientId, newBuffer);

      expect(result).toEqual(newBuffer);
    });

    it('should return new buffer when pending queue is empty', () => {
      const clientId = 'client-123';
      const newBuffer = Buffer.from('new audio');

      // Create empty pending queue
      (service as any).pendingAudioQueue[clientId] = [];

      const result = service.processPendingAudioQueue(clientId, newBuffer);

      expect(result).toEqual(newBuffer);
    });
  });

  describe('generateStorageKey', () => {
    it('should generate storage key with correct format', () => {
      const chatId = 123;
      const result = (service as any).generateStorageKey(chatId);

      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}\/chat-123-\d+\.raw$/);
    });

    it('should generate different keys for different chatIds', () => {
      const chatId1 = 123;
      const chatId2 = 456;

      const result1 = (service as any).generateStorageKey(chatId1);
      const result2 = (service as any).generateStorageKey(chatId2);

      expect(result1).toContain('chat-123-');
      expect(result2).toContain('chat-456-');
      expect(result1).not.toEqual(result2);
    });
  });

  describe('saveAudio', () => {
    it('should add to pending queue when chatId is placeholder', () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };
      const audioData = {
        chatId: PLACEHOLDER_CHAT_ID,
        audioBase64: Buffer.from('test audio').toString('base64'),
        shouldBroadcastAudioMessage: true,
      };

      service.saveAudio(session, audioData);

      const pendingQueue = (service as any).pendingAudioQueue;
      expect(pendingQueue[session.id]).toBeDefined();
      expect(pendingQueue[session.id].length).toBe(1);
    });

    it('should handle audio when no active stream exists', () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };
      const audioData = {
        chatId: 123,
        audioBase64: Buffer.from('test audio').toString('base64'),
        shouldBroadcastAudioMessage: true,
      };

      expect(() => service.saveAudio(session, audioData)).not.toThrow();
    });

    it('should process audio with active stream and broadcast', () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };
      const audioData = {
        chatId: 123,
        audioBase64: Buffer.from('test audio').toString('base64'),
        shouldBroadcastAudioMessage: true,
      };

      // Setup active stream
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 0,
          },
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file2',
            bufferSize: 0,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      service.saveAudio(session, audioData);

      expect(activeCallStreams[123].files[0].bufferSize).toBeGreaterThan(0);
      expect(
        broadcastMessageService.broadcastAudioStreamMessage,
      ).toHaveBeenCalled();
    });

    it('should process audio without broadcasting when shouldBroadcastAudioMessage is false', () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };
      const audioData = {
        chatId: 123,
        audioBase64: Buffer.from('test audio').toString('base64'),
        shouldBroadcastAudioMessage: false,
      };

      // Setup active stream
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 0,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      service.saveAudio(session, audioData);

      expect(
        broadcastMessageService.broadcastAudioStreamMessage,
      ).not.toHaveBeenCalled();
    });

    it('should flush file when buffer size exceeds minimum', async () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };
      const largeAudioData = {
        chatId: 123,
        audioBase64: Buffer.alloc(7 * 1024 * 1024).toString('base64'), // 7MB
        shouldBroadcastAudioMessage: true,
      };

      // Setup active stream
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 0,
          },
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file2',
            bufferSize: 0,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      service.saveAudio(session, largeAudioData);

      // The flushFileAsPart method is called asynchronously, so we need to wait
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(activeCallStreams[123].parts.length).toBeGreaterThan(0);
      expect(activeCallStreams[123].currentFileIndex).toBe(1);
    });
  });

  describe('endCallStream', () => {
    it('should handle case when no active stream exists', async () => {
      const callData = { chatId: 123 };

      await expect(service.endCallStream(callData)).resolves.not.toThrow();
    });

    it('should end call stream with multipart upload', async () => {
      const callData = { chatId: 123 };

      // Setup active stream with parts
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [{ ETag: 'etag1', PartNumber: 1 }],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 1000,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      s3Service.completeMultipartUpload.mockResolvedValue({
        $metadata: {} as any,
      });
      chatAudioUploadsService.updateAudioUpload.mockResolvedValue({} as any);
      chatService.updateCallMetadata.mockResolvedValue(undefined);

      await service.endCallStream(callData);

      expect(s3Service.completeMultipartUploadWithParts).toHaveBeenCalled();
      expect(chatAudioUploadsService.updateAudioUpload).toHaveBeenCalled();
      expect(activeCallStreams[123]).toBeUndefined();
    });

    it('should handle empty file case', async () => {
      const callData = { chatId: 123 };

      // Setup active stream with empty file
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 0,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      await service.endCallStream(callData);

      expect(activeCallStreams[123]).toBeUndefined();
    });

    it('should handle case with no parts and non-empty buffer', async () => {
      const callData = { chatId: 123 };

      // Setup active stream with no parts but non-empty buffer
      const activeCallStreams = (service as any).activeCallStreams;
      activeCallStreams[123] = {
        parts: [],
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        currentFileIndex: 0,
        files: [
          {
            fileWriteStream: { write: jest.fn(), end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 1000,
          },
        ],
        callId: 'call-123',
        chatId: 123,
      };

      await service.endCallStream(callData);

      expect(activeCallStreams[123]).toBeUndefined();
    });
  });

  describe('clearPendingAudioQueue', () => {
    it('should clear pending audio queue', () => {
      const callId = 'call-123';
      const audioBuffer = Buffer.from('test audio');

      service.addToPendingAudioQueue(callId, audioBuffer);
      service.clearPendingAudioQueue(callId);

      const pendingQueue = (service as any).pendingAudioQueue;
      expect(pendingQueue[callId]).toBeUndefined();
    });

    it('should handle clearing non-existent queue', () => {
      const callId = 'non-existent';

      expect(() => service.clearPendingAudioQueue(callId)).not.toThrow();
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context', () => {
      const session = {
        id: 'session-123',
        type: 'user' as const,
        userId: 456,
        user: {},
        role: 'counselor',
        room: 'room-123',
        chatId: 789,
        tenantId: 'tenant-123',
        provider: AudioChatProvider.WEBRTC,
      };

      service.setAuthContext(session);

      const {
        ExecutionManager,
        // eslint-disable-next-line @typescript-eslint/no-var-requires
      } = require('../../../common/execution/execution-manager');
      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        session.userId.toString(),
        session.role,
        session.tenantId,
      );
    });
  });

  describe('cleanUpTemporaryFiles', () => {
    it('should clean up temporary files', async () => {
      const files = ['/tmp/file1', '/tmp/file2'];
      const chatId = 123;

      await expect(
        (service as any).cleanUpTemporaryFiles(files, chatId),
      ).resolves.not.toThrow();
    });

    it('should handle case when files array is null', async () => {
      const chatId = 123;

      await expect(
        (service as any).cleanUpTemporaryFiles(null, chatId),
      ).resolves.not.toThrow();
    });

    it('should handle case when files array is undefined', async () => {
      const chatId = 123;

      await expect(
        (service as any).cleanUpTemporaryFiles(undefined, chatId),
      ).resolves.not.toThrow();
    });

    it('should handle case when files array is empty', async () => {
      const files: string[] = [];
      const chatId = 123;

      await expect(
        (service as any).cleanUpTemporaryFiles(files, chatId),
      ).resolves.not.toThrow();
    });
  });

  describe('handleEmptyFile', () => {
    it('should handle empty file', () => {
      const activeCallStream = {
        files: [{ tempFilePath: '/tmp/file1' }, { tempFilePath: '/tmp/file2' }],
      };
      const chatId = 123;

      expect(() =>
        (service as any).handleEmptyFile(activeCallStream, chatId),
      ).not.toThrow();
    });

    it('should handle empty file with no files array', () => {
      const activeCallStream = {
        files: null,
      };
      const chatId = 123;

      expect(() =>
        (service as any).handleEmptyFile(activeCallStream, chatId),
      ).not.toThrow();
    });

    it('should handle empty file with undefined files array', () => {
      const activeCallStream = {
        files: undefined,
      };
      const chatId = 123;

      expect(() =>
        (service as any).handleEmptyFile(activeCallStream, chatId),
      ).not.toThrow();
    });
  });

  describe('rollbackExternalOperations', () => {
    it('should rollback external operations with s3UploadId', async () => {
      const rollbackData = {
        s3UploadId: 'upload-123',
        tempFiles: ['/tmp/file1'],
        callId: 'call-123',
        chatId: 123,
        s3key: 'test-key',
      };

      s3Service.abortMultipartUpload.mockResolvedValue({
        $metadata: {} as any,
      });

      await (service as any).rollbackExternalOperations(rollbackData);

      expect(s3Service.abortMultipartUpload).toHaveBeenCalled();
    });

    it('should handle rollback when no s3UploadId', async () => {
      const rollbackData = {
        s3UploadId: null,
        tempFiles: ['/tmp/file1'],
        callId: 'call-123',
        chatId: 123,
        s3key: 'test-key',
      };

      await (service as any).rollbackExternalOperations(rollbackData);

      expect(s3Service.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('should handle rollback when no s3key', async () => {
      const rollbackData = {
        s3UploadId: 'upload-123',
        tempFiles: ['/tmp/file1'],
        callId: 'call-123',
        chatId: 123,
        s3key: null,
      };

      await (service as any).rollbackExternalOperations(rollbackData);

      expect(s3Service.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('should handle rollback when no chatId', async () => {
      const rollbackData = {
        s3UploadId: 'upload-123',
        tempFiles: ['/tmp/file1'],
        callId: 'call-123',
        chatId: null,
        s3key: 'test-key',
      };

      await (service as any).rollbackExternalOperations(rollbackData);

      expect(s3Service.abortMultipartUpload).toHaveBeenCalled();
    });
  });

  describe('flushFileAsPart', () => {
    it('should flush file as part', async () => {
      const activeCallStream = {
        uploadId: 'upload-123',
        key: 'test-key',
        partNumber: 1,
        parts: [],
        files: [
          {
            fileWriteStream: { end: jest.fn((cb) => cb()) },
            tempFilePath: '/tmp/file1',
            bufferSize: 1000,
          },
        ],
      };

      s3Service.uploadPart.mockResolvedValue({
        ETag: 'etag1',
        $metadata: {} as any,
      });

      await (service as any).flushFileAsPart({
        chatId: 123,
        activeCallStream,
        fileToFlushIndex: 0,
        provider: AudioChatProvider.WEBRTC,
      });

      expect(s3Service.uploadPart).toHaveBeenCalled();
      expect(activeCallStream.parts).toHaveLength(1);
      expect(activeCallStream.partNumber).toBe(2);
    });
  });

  describe('setupCallStream', () => {
    it('should setup call stream', async () => {
      const setupData = {
        session: { id: 'session-123' },
        chatId: 123,
        entityManager: mockEntityManager,
        sampleRate: 44100,
      };

      const mockChat = {
        chatId: 123,
        clientId: 456,
        counselorId: 789,
        chat: {} as any,
      };
      const mockUploadId = 'upload-123';

      chatService.createChatForAnonymousClient.mockResolvedValue(mockChat);
      s3Service.createMultipartUpload.mockResolvedValue({
        UploadId: mockUploadId,
        $metadata: {} as any,
      });
      chatAudioUploadsService.createAudioUpload.mockResolvedValue({} as any);

      const result = await (service as any).setupCallStream(setupData);

      expect(result).toHaveProperty('uploadId');
      expect(result).toHaveProperty('files');
      expect(result).toHaveProperty('key');
    });
  });
});
