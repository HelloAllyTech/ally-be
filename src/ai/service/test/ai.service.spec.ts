import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { AiService } from '../ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';

// Mock external dependencies
jest.mock('axios');

const mockedAxios = axios as any;

describe('AiService', () => {
  let service: AiService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockPromptSharedService: jest.Mocked<PromptSharedService>;

  const mockConfig = {
    ai: {
      apiUrl: 'https://test-ai-api.com',
      outboundApiKey: 'test-outbound-api-key',
    },
  };

  beforeEach(async () => {
    // Mock LoggerService
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);

    const mockConfigService = {
      ai: mockConfig.ai,
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };
    mockPromptSharedService = {
      getPromptsByOptions: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: PromptSharedService,
          useValue: mockPromptSharedService,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should set logger instance', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith('AiService');
    });
  });

  describe('transcribeAudioFromBuffer', () => {
    it('should transcribe audio from buffer successfully', async () => {
      const mockBuffer = Buffer.from('audio data');
      const mockResponse = { data: { text: 'Transcribed text' } };

      mockedAxios.mockResolvedValue(mockResponse);

      const result = await service.transcribeAudioFromBuffer(mockBuffer);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `${mockConfig.ai.apiUrl}/transcribe`,
          method: 'post',
          data: mockBuffer,
          headers: expect.objectContaining({ 'Content-Type': 'audio/webm' }),
        }),
      );
      expect(result).toBe('Transcribed text');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Transcription received: Transcribed text',
      );
    });

    it('should handle transcription error', async () => {
      const mockBuffer = Buffer.from('audio data');
      const error = new Error('Transcription failed');

      mockedAxios.mockRejectedValue(error);

      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow('AI transcription failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Transcription failed'),
      );
    });
  });

  describe('getNudge', () => {
    const mockChatHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    it('should get nudge successfully', async () => {
      const mockResponse = { data: { nudge: 'Test nudge', confidence: 0.8 } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.getNudge('New message', mockChatHistory);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should return early when apiUrl is not configured', async () => {
      const serviceWithoutUrl = new AiService(
        { ai: { ...mockConfig.ai, apiUrl: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
      );

      const result = await serviceWithoutUrl.getNudge(
        'New message',
        mockChatHistory,
      );

      expect(result).toBeUndefined();
      expect(mockedAxios).not.toHaveBeenCalled();
    });

    it('should handle nudge request error gracefully', async () => {
      const error = new Error('Nudge failed');
      (mockedAxios as any).mockRejectedValue(error);

      // The method doesn't throw by default - it returns empty object and emits event
      const result = await service.getNudge('New message', mockChatHistory);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Request FAIL'),
        expect.anything(),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Nudge failed'),
        expect.anything(),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          type: 'AI Request Error',
        }),
      );
    });
  });

  describe('generateSummaryAndTags', () => {
    const mockMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    it('should generate summary and tags successfully', async () => {
      const mockResponse = {
        data: {
          summary: 'Generated summary',
          tags: ['greeting', 'conversation'],
          sentiment: 'positive',
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.generateSummaryAndTags(mockMessages);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle summary generation error gracefully', async () => {
      const error = new Error('Summary failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method catches errors and returns undefined
      const result = await service.generateSummaryAndTags(mockMessages);

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Summary failed'),
      );
    });
  });

  describe('generateTagPositivityRatings', () => {
    const mockTags = ['positive', 'helpful', 'supportive'];

    it('should generate tag positivity ratings successfully', async () => {
      const mockResponse = {
        data: {
          ratings: { positive: 0.9, helpful: 0.8, supportive: 0.85 },
          overall_score: 0.85,
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.generateTagPositivityRatings(mockTags);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle tag rating error gracefully', async () => {
      const error = new Error('Tag rating failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method returns {} on error (doesn't throw)
      const result = await service.generateTagPositivityRatings(mockTags);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Tag rating failed'),
        expect.anything(),
      );
    });
  });

  describe('addReferenceDocument', () => {
    const mockDocument = {
      document_id: 'doc-123',
      heading: 'Test Document',
      category: 'guide',
      content: 'Document content',
      tenant_id: 'tenant-1',
    };

    it('should add reference document successfully', async () => {
      const mockResponse = {
        data: {
          id: 'doc-123',
          status: 'created',
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.addReferenceDocument(mockDocument);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle add document error by throwing', async () => {
      const error = new Error('Add document failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method throws the error since throwError = true
      await expect(service.addReferenceDocument(mockDocument)).rejects.toThrow(
        'Add document failed',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Add document failed'),
        expect.anything(),
      );
    });
  });

  describe('transcribeAudioAndSummarize', () => {
    const mockRequest = {
      presigned_url: 'https://example.com/audio.wav',
      chat_id: 123,
      sample_rate: 44100,
    };

    it('should transcribe and summarize audio successfully', async () => {
      const mockResponse = {
        data: {
          transcript: 'Transcribed text',
          summary: 'Summary text',
          confidence: 0.95,
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.transcribeAudioAndSummarize(mockRequest);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle transcribe and summarize error gracefully', async () => {
      const error = new Error('Transcribe and summarize failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method returns {} on error (doesn't throw)
      const result = await service.transcribeAudioAndSummarize(mockRequest);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'errMsg=Transcribe and summarize failed',
        ),
        expect.anything(),
      );
    });
  });

  describe('enhance', () => {
    const mockSummary = 'Original summary text';

    it('should enhance summary successfully', async () => {
      const mockResponse = {
        data: {
          enhanced_text: 'Enhanced summary text',
          improvements: ['clarity', 'grammar'],
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.enhance(mockSummary);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle enhance error gracefully', async () => {
      const error = new Error('Enhance failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method returns {} on error (doesn't throw)
      const result = await service.enhance(mockSummary);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Enhance failed'),
        expect.anything(),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = { code: 'ENOTFOUND', message: 'Network error' };
      mockedAxios.mockRejectedValue(networkError);

      const mockBuffer = Buffer.from('audio data');
      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow('AI transcription failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Network error'),
      );
    });

    it('should handle timeout errors', async () => {
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      mockedAxios.mockRejectedValue(timeoutError);

      const mockBuffer = Buffer.from('audio data');
      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow('AI transcription failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: timeout'),
      );
    });

    it('should emit exception events for axios errors in makeRequest', async () => {
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      (mockedAxios as any).mockRejectedValue(timeoutError);

      const mockMessages = [{ role: 'user', content: 'test' }];
      const result = await service.generateSummaryAndTags(mockMessages);

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          type: 'AI Request Error',
          message: expect.stringContaining('timeout'),
        }),
      );
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle missing API URL', async () => {
      const serviceWithoutUrl = new AiService(
        { ai: { ...mockConfig.ai, apiUrl: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
      );

      const mockChatHistory = [{ role: 'user', content: 'test' }];
      const result = await serviceWithoutUrl.getNudge('test', mockChatHistory);

      expect(result).toBeUndefined();
    });

    it('should handle missing outbound API key', async () => {
      const serviceWithoutKey = new AiService(
        { ai: { ...mockConfig.ai, outboundApiKey: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
      );

      expect(serviceWithoutKey).toBeDefined();
    });
  });

  describe('Logging and Debugging', () => {
    it('should log requests and responses', async () => {
      const mockResponse = { data: { result: 'test' } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const mockMessages = [{ role: 'user', content: 'test' }];
      await service.generateSummaryAndTags(mockMessages);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('AI Request BODY'),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('AI Response BODY'),
      );
    });

    it('should log errors with execution ID', async () => {
      const error = new Error('Test error');
      (mockedAxios as any).mockRejectedValue(error);

      const mockMessages = [{ role: 'user', content: 'test' }];
      await service.generateSummaryAndTags(mockMessages);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Test error'),
      );
    });
  });
});
