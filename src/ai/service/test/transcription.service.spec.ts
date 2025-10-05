import { Test, TestingModule } from '@nestjs/testing';
import { TranscriptionService } from '../transcription.service';
import { ITranscriptionService } from '../../interfaces/transcription.interface';
import { UserChatSessionData } from '../../../chat/type/chat.type';
import { DeepgramTranscriptionOptions } from '../../type/transcription.type';

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let mockTranscriptionService: jest.Mocked<ITranscriptionService>;

  const mockUserSession: UserChatSessionData = {
    id: 'session-123',
    type: 'user',
    userId: 456,
    user: { id: 456, name: 'Test User' },
    role: 'counselor',
    room: 'test-room',
    chatId: 789,
    tenantId: 'tenant-123',
    provider: undefined,
  };

  const mockOptions: DeepgramTranscriptionOptions = {
    model: 'nova-3',
    smartFormat: true,
    interimResults: true,
    numerals: false,
    punctuate: true,
    channels: 1,
    endpointing: 300,
    utteranceEndMs: 2000,
    language: 'multi',
    diarize: false,
  };

  beforeEach(async () => {
    mockTranscriptionService = {
      startLiveTranscription: jest.fn(),
      stopLiveTranscription: jest.fn(),
      sendAudio: jest.fn(),
      handleAudioChatMuted: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionService,
        {
          provide: 'transcriptionService',
          useValue: mockTranscriptionService,
        },
      ],
    }).compile();

    service = module.get<TranscriptionService>(TranscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startLiveTranscription', () => {
    it('should start live transcription successfully with all parameters', async () => {
      const chatId = 123;
      const chatCreatedAt = new Date();
      const callback = jest.fn();

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt,
          options: mockOptions,
        },
        callback,
      );

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledWith(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt,
          options: mockOptions,
        },
        callback,
      );
      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledTimes(1);
    });

    it('should start live transcription without chatCreatedAt', async () => {
      const chatId = 456;
      const callback = jest.fn();

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
          options: mockOptions,
        },
        callback,
      );

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledWith(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt: undefined,
          options: mockOptions,
        },
        callback,
      );
    });

    it('should start live transcription without options', async () => {
      const chatId = 789;
      const callback = jest.fn();

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
        },
        callback,
      );

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledWith(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt: undefined,
          options: undefined,
        },
        callback,
      );
    });

    it('should handle startLiveTranscription error', async () => {
      const chatId = 999;
      const callback = jest.fn();
      const error = new Error('Failed to start transcription');

      mockTranscriptionService.startLiveTranscription.mockRejectedValue(error);

      await expect(
        service.startLiveTranscription(
          {
            session: mockUserSession,
            chatId,
          },
          callback,
        ),
      ).rejects.toThrow('Failed to start transcription');
    });

    it('should pass callback function correctly', async () => {
      const chatId = 111;
      const callback = jest.fn();

      mockTranscriptionService.startLiveTranscription.mockImplementation(
        async (params, cb) => {
          // Simulate calling the callback
          cb(mockUserSession, chatId, 'test transcript');
        },
      );

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
        },
        callback,
      );

      expect(callback).toHaveBeenCalledWith(
        mockUserSession,
        chatId,
        'test transcript',
      );
    });
  });

  describe('stopLiveTranscription', () => {
    it('should stop live transcription successfully', async () => {
      mockTranscriptionService.stopLiveTranscription.mockResolvedValue();

      await service.stopLiveTranscription(mockUserSession);

      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).toHaveBeenCalledWith(mockUserSession);
      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).toHaveBeenCalledTimes(1);
    });

    it('should handle stopLiveTranscription error', async () => {
      const error = new Error('Failed to stop transcription');
      mockTranscriptionService.stopLiveTranscription.mockRejectedValue(error);

      await expect(
        service.stopLiveTranscription(mockUserSession),
      ).rejects.toThrow('Failed to stop transcription');
    });

    it('should stop transcription for different user sessions', async () => {
      const anotherSession: UserChatSessionData = {
        ...mockUserSession,
        id: 'session-456',
        userId: 789,
      };

      mockTranscriptionService.stopLiveTranscription.mockResolvedValue();

      await service.stopLiveTranscription(anotherSession);

      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).toHaveBeenCalledWith(anotherSession);
    });
  });

  describe('sendAudio', () => {
    it('should send audio successfully', async () => {
      const audioBuffer = Buffer.from('audio data');
      mockTranscriptionService.sendAudio.mockResolvedValue();

      await service.sendAudio(mockUserSession, audioBuffer);

      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledWith(
        mockUserSession,
        audioBuffer,
      );
      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledTimes(1);
    });

    it('should handle sendAudio error', async () => {
      const audioBuffer = Buffer.from('audio data');
      const error = new Error('Failed to send audio');
      mockTranscriptionService.sendAudio.mockRejectedValue(error);

      await expect(
        service.sendAudio(mockUserSession, audioBuffer),
      ).rejects.toThrow('Failed to send audio');
    });

    it('should send empty audio buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      mockTranscriptionService.sendAudio.mockResolvedValue();

      await service.sendAudio(mockUserSession, emptyBuffer);

      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledWith(
        mockUserSession,
        emptyBuffer,
      );
    });

    it('should send large audio buffer', async () => {
      const largeBuffer = Buffer.alloc(1024 * 1024, 'a'); // 1MB buffer
      mockTranscriptionService.sendAudio.mockResolvedValue();

      await service.sendAudio(mockUserSession, largeBuffer);

      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledWith(
        mockUserSession,
        largeBuffer,
      );
    });
  });

  describe('handleAudioChatMuted', () => {
    it('should handle audio chat muted successfully', async () => {
      mockTranscriptionService.handleAudioChatMuted.mockResolvedValue();

      await service.handleAudioChatMuted(mockUserSession);

      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).toHaveBeenCalledWith(mockUserSession);
      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).toHaveBeenCalledTimes(1);
    });

    it('should handle handleAudioChatMuted error', async () => {
      const error = new Error('Failed to handle muted audio');
      mockTranscriptionService.handleAudioChatMuted.mockRejectedValue(error);

      await expect(
        service.handleAudioChatMuted(mockUserSession),
      ).rejects.toThrow('Failed to handle muted audio');
    });

    it('should handle muted audio for different user sessions', async () => {
      const differentSession: UserChatSessionData = {
        ...mockUserSession,
        id: 'session-999',
        userId: 111,
        role: 'client',
      };

      mockTranscriptionService.handleAudioChatMuted.mockResolvedValue();

      await service.handleAudioChatMuted(differentSession);

      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).toHaveBeenCalledWith(differentSession);
    });
  });

  describe('edge cases and integration', () => {
    it('should handle multiple operations in sequence', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const audioBuffer = Buffer.from('test audio');

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();
      mockTranscriptionService.sendAudio.mockResolvedValue();
      mockTranscriptionService.handleAudioChatMuted.mockResolvedValue();
      mockTranscriptionService.stopLiveTranscription.mockResolvedValue();

      // Start transcription
      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      // Send audio
      await service.sendAudio(mockUserSession, audioBuffer);

      // Handle muted
      await service.handleAudioChatMuted(mockUserSession);

      // Stop transcription
      await service.stopLiveTranscription(mockUserSession);

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledTimes(1);
      expect(mockTranscriptionService.sendAudio).toHaveBeenCalledTimes(1);
      expect(
        mockTranscriptionService.handleAudioChatMuted,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockTranscriptionService.stopLiveTranscription,
      ).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent operations', async () => {
      const chatId = 123;
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const session2: UserChatSessionData = {
        ...mockUserSession,
        id: 'session-concurrent',
        userId: 999,
      };

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();

      const promises = [
        service.startLiveTranscription(
          { session: mockUserSession, chatId },
          callback1,
        ),
        service.startLiveTranscription(
          { session: session2, chatId: chatId + 1 },
          callback2,
        ),
      ];

      await Promise.all(promises);

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledTimes(2);
    });

    it('should handle all transcription options variations', async () => {
      const chatId = 123;
      const callback = jest.fn();

      const fullOptions: DeepgramTranscriptionOptions = {
        model: 'nova-3',
        smartFormat: false,
        interimResults: false,
        numerals: true,
        punctuate: false,
        channels: 2,
        endpointing: 500,
        utteranceEndMs: 3000,
        language: 'en',
        diarize: true,
        encoding: 'linear16',
        sample_rate: 16000,
      };

      mockTranscriptionService.startLiveTranscription.mockResolvedValue();

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt: new Date(),
          options: fullOptions,
        },
        callback,
      );

      expect(
        mockTranscriptionService.startLiveTranscription,
      ).toHaveBeenCalledWith(
        {
          session: mockUserSession,
          chatId,
          chatCreatedAt: expect.any(Date),
          options: fullOptions,
        },
        callback,
      );
    });
  });
});
