import { Test, TestingModule } from '@nestjs/testing';
import { DeepgramService } from '../deepgram.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { UserChatSessionData } from '../../../chat/type/chat.type';
import {
  DeepgramTranscriptionOptions,
  DeepgramTranscriptResult,
} from '../../type/transcription.type';
import {
  createClient,
  DeepgramClient,
  LiveClient,
  LiveTranscriptionEvents,
} from '@deepgram/sdk';

// Mock the Deepgram SDK
jest.mock('@deepgram/sdk');
jest.mock('../../../logger/logger.service');

describe('DeepgramService', () => {
  let service: DeepgramService;
  let mockConfig: jest.Mocked<AppConfigService>;
  let mockDeepgramClient: jest.Mocked<DeepgramClient>;
  let mockLiveClient: jest.Mocked<LiveClient>;
  let mockLogger: jest.Mocked<LoggerService>;

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

  const mockTranscriptResult: DeepgramTranscriptResult = {
    type: 'Results',
    channel_index: [0],
    duration: 2.5,
    start: 0,
    is_final: true,
    speech_final: true,
    channel: {
      alternatives: [
        {
          transcript: 'Hello world',
          confidence: 0.95,
          languages: ['en'],
          words: [
            {
              word: 'Hello',
              start: 0.0,
              end: 0.5,
              confidence: 0.95,
              punctuated_word: 'Hello',
              language: 'en',
              speaker: 0,
            },
            {
              word: 'world',
              start: 0.6,
              end: 1.0,
              confidence: 0.92,
              punctuated_word: 'world.',
              language: 'en',
              speaker: 0,
            },
          ],
        },
      ],
    },
    metadata: {
      request_id: 'req-123',
      model_info: {
        name: 'nova-3',
        version: '1.0',
        arch: 'x86_64',
      },
      model_uuid: 'model-uuid-123',
    },
    from_finalize: false,
  };

  beforeEach(async () => {
    // Mock configuration
    mockConfig = {
      ai: {
        deepgramApiKey: 'test-api-key',
      },
    } as any;

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getInstance: jest.fn().mockReturnThis(),
    } as any;

    // Mock LiveClient
    mockLiveClient = {
      on: jest.fn().mockReturnThis(),
      send: jest.fn(),
      keepAlive: jest.fn(),
      finalize: jest.fn().mockResolvedValue(undefined),
      requestClose: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock DeepgramClient
    mockDeepgramClient = {
      listen: {
        live: jest.fn().mockReturnValue(mockLiveClient),
      },
    } as any;

    // Mock createClient
    (createClient as jest.Mock).mockReturnValue(mockDeepgramClient);

    // Mock LoggerService.getInstance
    (LoggerService.getInstance as jest.Mock).mockReturnValue(mockLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepgramService,
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<DeepgramService>(DeepgramService);
  });

  afterEach(async () => {
    // Clean up any live connections and intervals to prevent Jest from hanging
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(createClient).toHaveBeenCalledWith('test-api-key');
      expect(LoggerService.getInstance).toHaveBeenCalledWith('DeepgramService');
    });
  });

  describe('startLiveTranscription', () => {
    it('should start live transcription successfully', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const options: DeepgramTranscriptionOptions = {
        model: 'nova-3',
        smartFormat: true,
        interimResults: true,
      };

      // Mock the open event to resolve immediately
      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          // Call handler synchronously to avoid timing issues
          handler();
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
          options,
        },
        callback,
      );

      expect(mockDeepgramClient.listen.live).toHaveBeenCalledWith({
        model: 'nova-3',
        smart_format: true,
        interim_results: true,
        numerals: false,
        punctuate: true,
        channels: 1,
        endpointing: 300,
        utterance_end_ms: 2000,
        language: 'multi',
        diarize: false,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `startLiveTranscription -  userId: ${mockUserSession.userId}`,
      );
    });

    it('should warn if live transcription already exists', async () => {
      const chatId = 123;
      const callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      // Start first transcription
      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      // Try to start second transcription for same session
      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `startLiveTranscription - Live transcription already exists for userId: ${mockUserSession.userId}`,
      );
    });

    it('should handle error during transcription setup', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const error = new Error('Connection failed');

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Error) {
          handler(error);
        }
        return mockLiveClient;
      });

      await expect(
        service.startLiveTranscription(
          { session: mockUserSession, chatId },
          callback,
        ),
      ).rejects.toThrow('Connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `startLiveTranscription - Failed to start live transcription for userId: ${mockUserSession.userId}`,
        error,
      );
    });

    it('should create live client with default options', async () => {
      const chatId = 123;
      const callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      expect(mockDeepgramClient.listen.live).toHaveBeenCalledWith({
        model: 'nova-3',
        smart_format: true,
        interim_results: true,
        numerals: false,
        punctuate: true,
        channels: 1,
        endpointing: 300,
        utterance_end_ms: 2000,
        language: 'multi',
        diarize: false,
      });
    });

    it('should create live client with custom options', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const options: DeepgramTranscriptionOptions = {
        model: 'nova-2',
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

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        {
          session: mockUserSession,
          chatId,
          options,
        },
        callback,
      );

      expect(mockDeepgramClient.listen.live).toHaveBeenCalledWith({
        model: 'nova-2',
        smart_format: false,
        interim_results: false,
        numerals: true,
        punctuate: false,
        channels: 2,
        endpointing: 500,
        utterance_end_ms: 3000,
        language: 'en',
        diarize: true,
        encoding: 'linear16',
        sample_rate: 16000,
      });
    });
  });

  describe('stopLiveTranscription', () => {
    it('should stop live transcription successfully', async () => {
      const chatId = 123;
      const callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      // Start transcription first
      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      // Now stop it
      await service.stopLiveTranscription(mockUserSession);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Stopping live transcription for userId: ${mockUserSession.id}`,
      );
      expect(mockLiveClient.finalize).toHaveBeenCalled();
      expect(mockLiveClient.requestClose).toHaveBeenCalled();
    });

    it('should handle stop transcription when no session exists', async () => {
      await service.stopLiveTranscription(mockUserSession);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Stopping live transcription for userId: ${mockUserSession.id}`,
      );
      // Should not throw error
    });

    it('should handle error during cleanup', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const error = new Error('Cleanup failed');

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      (mockLiveClient.finalize as jest.Mock).mockRejectedValue(error);

      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      await service.stopLiveTranscription(mockUserSession);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error closing connection for userId: ${mockUserSession.id}`,
        error,
      );
    });
  });

  describe('sendAudio', () => {
    it('should send audio when transcription is active', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const audioBuffer = Buffer.from('audio data');

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      await service.sendAudio(mockUserSession, audioBuffer);

      expect(mockLiveClient.send).toHaveBeenCalledWith(audioBuffer);
    });

    it('should queue audio when transcription is not active', async () => {
      const audioBuffer = Buffer.from('audio data');

      await service.sendAudio(mockUserSession, audioBuffer);

      // Audio should be queued, not sent immediately
      expect(mockLiveClient.send).not.toHaveBeenCalled();
    });

    it('should handle send audio error', async () => {
      const chatId = 123;
      const callback = jest.fn();
      const audioBuffer = Buffer.from('audio data');
      const error = new Error('Send failed');

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      mockLiveClient.send.mockImplementation(() => {
        throw error;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      await expect(
        service.sendAudio(mockUserSession, audioBuffer),
      ).rejects.toThrow('Send failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to send audio for userId: ${mockUserSession.userId} | sessionId: ${mockUserSession.id}`,
        error,
      );
    });
  });

  describe('handleAudioChatMuted', () => {
    it('should finalize live client when session exists', async () => {
      const chatId = 123;
      const callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId },
        callback,
      );

      await service.handleAudioChatMuted(mockUserSession);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `handleAudioChatMuted for userId: ${mockUserSession.userId}`,
      );
      expect(mockLiveClient.finalize).toHaveBeenCalled();
    });

    it('should handle muted audio when no session exists', async () => {
      await service.handleAudioChatMuted(mockUserSession);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `handleAudioChatMuted for userId: ${mockUserSession.userId}`,
      );
      // Should not throw error
    });
  });

  describe('onModuleDestroy', () => {
    it('should cleanup all connections on module destroy', async () => {
      const chatId1 = 123;
      const chatId2 = 456;
      const callback = jest.fn();
      const session2: UserChatSessionData = {
        ...mockUserSession,
        id: 'session-456',
        userId: 789,
      };

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        }
        return mockLiveClient;
      });

      // Start multiple transcriptions
      await service.startLiveTranscription(
        { session: mockUserSession, chatId: chatId1 },
        callback,
      );
      await service.startLiveTranscription(
        { session: session2, chatId: chatId2 },
        callback,
      );

      await service.onModuleDestroy();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cleaning up all connections',
      );
      expect(mockLiveClient.finalize).toHaveBeenCalledTimes(2);
      expect(mockLiveClient.requestClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('transcript event handling', () => {
    let callback: jest.Mock;
    let transcriptHandler: (data: DeepgramTranscriptResult) => void;

    beforeEach(async () => {
      callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        } else if (event === LiveTranscriptionEvents.Transcript) {
          transcriptHandler = handler;
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId: 123 },
        callback,
      );
    });

    it('should handle transcript event with final transcript', () => {
      const finalTranscriptResult = {
        ...mockTranscriptResult,
        is_final: true,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              transcript: 'Hello world.',
            },
          ],
        },
      };

      transcriptHandler(finalTranscriptResult);

      expect(callback).toHaveBeenCalledWith(
        mockUserSession,
        123,
        'Hello world.',
        expect.objectContaining({
          isFinal: true,
          isSentenceComplete: true,
          currentTranscriptBuffer: 'Hello world.',
        }),
      );
    });

    it('should handle transcript event with interim results', () => {
      const interimTranscriptResult = {
        ...mockTranscriptResult,
        is_final: false,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              transcript: 'Hello',
            },
          ],
        },
      };

      transcriptHandler(interimTranscriptResult);

      expect(callback).toHaveBeenCalledWith(
        mockUserSession,
        123,
        'Hello',
        expect.objectContaining({
          isFinal: false,
          isSentenceComplete: false,
          currentTranscriptBuffer: 'Hello',
        }),
      );
    });

    it('should handle empty transcript', () => {
      const emptyTranscriptResult = {
        ...mockTranscriptResult,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              transcript: '',
            },
          ],
        },
      };

      transcriptHandler(emptyTranscriptResult);

      // Should not call callback for empty transcript
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only transcript', () => {
      const whitespaceTranscriptResult = {
        ...mockTranscriptResult,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              transcript: '   \n\t  ',
            },
          ],
        },
      };

      transcriptHandler(whitespaceTranscriptResult);

      // Should not call callback for whitespace-only transcript
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('sentence completion detection', () => {
    let callback: jest.Mock;
    let transcriptHandler: (data: DeepgramTranscriptResult) => void;

    beforeEach(async () => {
      callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        } else if (event === LiveTranscriptionEvents.Transcript) {
          transcriptHandler = handler;
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId: 123 },
        callback,
      );
    });

    it('should detect sentence completion with punctuation', () => {
      const testCases = [
        { transcript: 'This is a sentence.', shouldBeComplete: true },
        { transcript: 'Is this a question?', shouldBeComplete: true },
        { transcript: 'This is exciting!', shouldBeComplete: true },
        { transcript: 'This is incomplete', shouldBeComplete: false },
      ];

      for (const testCase of testCases) {
        callback.mockClear();

        const transcriptResult = {
          ...mockTranscriptResult,
          is_final: true,
          channel: {
            alternatives: [
              {
                ...mockTranscriptResult.channel.alternatives[0],
                transcript: testCase.transcript,
              },
            ],
          },
        };

        transcriptHandler(transcriptResult);

        expect(callback).toHaveBeenCalledWith(
          mockUserSession,
          123,
          testCase.transcript,
          expect.objectContaining({
            isSentenceComplete: testCase.shouldBeComplete,
          }),
        );
      }
    });
  });

  describe('word count by language', () => {
    let callback: jest.Mock;
    let transcriptHandler: (data: DeepgramTranscriptResult) => void;

    beforeEach(async () => {
      callback = jest.fn();

      mockLiveClient.on.mockImplementation((event, handler) => {
        if (event === LiveTranscriptionEvents.Open) {
          handler();
        } else if (event === LiveTranscriptionEvents.Transcript) {
          transcriptHandler = handler;
        }
        return mockLiveClient;
      });

      await service.startLiveTranscription(
        { session: mockUserSession, chatId: 123 },
        callback,
      );
    });

    it('should handle word count with missing language', () => {
      const transcriptWithMissingLanguage = {
        ...mockTranscriptResult,
        is_final: true,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              words: [
                {
                  word: 'Hello',
                  start: 0.0,
                  end: 0.5,
                  confidence: 0.95,
                  punctuated_word: 'Hello',
                  // language is undefined
                  speaker: 0,
                },
              ],
            },
          ],
        },
      };

      transcriptHandler(transcriptWithMissingLanguage);

      expect(callback).toHaveBeenCalledWith(
        mockUserSession,
        123,
        'Hello world',
        expect.objectContaining({
          wordCountByLanguage: {
            unknown: 1,
          },
        }),
      );
    });

    it('should handle empty words array for word count', () => {
      const transcriptWithEmptyWords = {
        ...mockTranscriptResult,
        is_final: true,
        channel: {
          alternatives: [
            {
              ...mockTranscriptResult.channel.alternatives[0],
              transcript: 'test',
              words: [],
            },
          ],
        },
      };

      transcriptHandler(transcriptWithEmptyWords);

      expect(callback).toHaveBeenCalledWith(
        mockUserSession,
        123,
        'test',
        expect.objectContaining({
          wordCountByLanguage: undefined,
        }),
      );
    });
  });
});
