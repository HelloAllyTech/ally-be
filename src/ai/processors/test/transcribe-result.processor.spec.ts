import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { TranscribeResultProcessor } from '../transcribe-result.processor';
import { ChatAiService } from '../../../chat/service/chat-ai-service';
import { ChatService } from '../../../chat/service/chat.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { TranscribeAndSummarizeResponseMessage } from '../../dto/transcribe-and-summarize-response.model';
import { ChatSummaryStatus } from '../../../common/entities/chat.entity';
import { FailedDependencyException } from '../../../exception/custom.exception';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TranscribeResultProcessor', () => {
  let processor: TranscribeResultProcessor;
  let chatAiService: jest.Mocked<ChatAiService>;
  let chatService: jest.Mocked<ChatService>;
  let configService: jest.Mocked<AppConfigService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockChat = {
    id: 'chat-123',
    summaryStatus: ChatSummaryStatus.IN_PROGRESS,
    messages: [],
  };

  const mockTranscribeResponse: TranscribeAndSummarizeResponseMessage = {
    message_type: 'transcribe_and_summarize_response',
    timestamp: Date.now(),
    chat_id: 123,
    download_presigned_url: 'https://s3.amazonaws.com/download/result.json',
    delete_presigned_url: 'https://s3.amazonaws.com/delete/result.json',
  };

  const mockS3Result = {
    transcription: 'This is the transcribed text',
    summary: 'This is the summary',
    confidence: 0.95,
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

    const mockChatAiService = {
      addTranscript: jest.fn(),
      addSummary: jest.fn(),
    };

    const mockChatService = {
      getChatByIdForServiceCall: jest.fn(),
      updateChat: jest.fn(),
    };

    const mockConfigService = {
      isDevelopment: false,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscribeResultProcessor,
        {
          provide: ChatAiService,
          useValue: mockChatAiService,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    processor = module.get<TranscribeResultProcessor>(
      TranscribeResultProcessor,
    );
    chatAiService = module.get(ChatAiService);
    chatService = module.get(ChatService);
    configService = module.get(AppConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and basic setup', () => {
    it('should be defined', () => {
      expect(processor).toBeDefined();
    });

    it('should initialize logger', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith(
        'TranscribeResultProcessor',
      );
    });
  });

  describe('getEventType', () => {
    it('should return correct event type', () => {
      expect(processor.getEventType()).toBe(
        'transcribe_and_summarize_response',
      );
    });
  });

  describe('process', () => {
    it('should process transcription result successfully', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      mockedAxios.delete.mockResolvedValue({});
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(mockTranscribeResponse);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        mockTranscribeResponse.download_presigned_url,
      );
      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        mockS3Result.transcription,
      );
      expect(chatAiService.addSummary).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        mockS3Result.summary,
      );
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        mockTranscribeResponse.delete_presigned_url,
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        },
      );
    });

    it('should return early when chat not found', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(null as any);

      await processor.process(mockTranscribeResponse);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(chatAiService.addTranscript).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should return early when chat already has summary', async () => {
      const chatWithSummary = {
        ...mockChat,
        summaryStatus: ChatSummaryStatus.SUCCESS,
      };
      chatService.getChatByIdForServiceCall.mockResolvedValue(
        chatWithSummary as any,
      );

      await processor.process(mockTranscribeResponse);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(chatAiService.addTranscript).not.toHaveBeenCalled();
      expect(chatService.updateChat).not.toHaveBeenCalled();
    });

    it('should handle error from AI service', async () => {
      const errorResponse = {
        ...mockTranscribeResponse,
        error: 'AI service failed',
      };

      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);

      await expect(processor.process(errorResponse)).rejects.toThrow(
        FailedDependencyException,
      );

      expect(chatService.updateChat).toHaveBeenCalledWith(
        errorResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: { error: expect.any(FailedDependencyException) },
        },
      );
    });

    it('should process without download URL', async () => {
      const responseWithoutDownload = {
        ...mockTranscribeResponse,
        download_presigned_url: undefined,
      };

      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.delete.mockResolvedValue({});
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(responseWithoutDownload);

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(chatAiService.addTranscript).not.toHaveBeenCalled();
      expect(chatAiService.addSummary).not.toHaveBeenCalled();
      expect(chatService.updateChat).toHaveBeenCalledWith(
        responseWithoutDownload.chat_id,
        {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        },
      );
    });

    it('should skip deletion in development mode', async () => {
      (configService as any).isDevelopment = true;
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(mockTranscribeResponse);

      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        },
      );
    });

    it('should process without delete URL', async () => {
      const responseWithoutDelete = {
        ...mockTranscribeResponse,
        delete_presigned_url: undefined,
      };

      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(responseWithoutDelete);

      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(chatService.updateChat).toHaveBeenCalledWith(
        responseWithoutDelete.chat_id,
        {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        },
      );
    });

    it('should handle S3 download error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      const s3Error = new Error('S3 download failed');
      mockedAxios.get.mockRejectedValue(s3Error);

      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow();

      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: { error: expect.any(Error) },
        },
      );
    });

    it('should handle chat service error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      const chatError = new Error('Chat service failed');
      chatAiService.addTranscript.mockRejectedValue(chatError);

      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow(
        'Chat service failed',
      );

      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: { error: chatError },
        },
      );
    });

    it('should handle S3 delete error gracefully', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      const deleteError = new Error('S3 delete failed');
      mockedAxios.delete.mockRejectedValue(deleteError);
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      // Should not throw error for delete failure
      await processor.process(mockTranscribeResponse);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete from S3:'),
      );
      expect(chatService.updateChat).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        {
          summaryStatus: ChatSummaryStatus.SUCCESS,
        },
      );
    });

    it('should handle empty S3 result', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: {} });
      mockedAxios.delete.mockResolvedValue({});
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(mockTranscribeResponse);

      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        undefined,
      );
      expect(chatAiService.addSummary).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        undefined,
      );
    });

    it('should handle null S3 result', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: null });
      mockedAxios.delete.mockResolvedValue({});
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      // The processor doesn't handle null S3 results, so it should throw
      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow();

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(123);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/download/result.json',
      );
    });

    it('should handle concurrent processing', async () => {
      const response1 = { ...mockTranscribeResponse, chat_id: 1 };
      const response2 = { ...mockTranscribeResponse, chat_id: 2 };

      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      mockedAxios.delete.mockResolvedValue({});
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await Promise.all([
        processor.process(response1),
        processor.process(response2),
      ]);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledTimes(2);
      expect(chatService.updateChat).toHaveBeenCalledTimes(2);
    });
  });

  describe('downloadFromS3 private method', () => {
    it('should handle axios timeout error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      mockedAxios.get.mockRejectedValue(timeoutError);

      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download from S3:'),
      );
    });

    it('should handle network error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      const networkError = { code: 'ENOTFOUND', message: 'Network error' };
      mockedAxios.get.mockRejectedValue(networkError);

      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download from S3:'),
      );
    });
  });

  describe('deleteFromS3 private method', () => {
    it('should handle axios delete timeout error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      mockedAxios.delete.mockRejectedValue(timeoutError);
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      // Should not throw for delete errors
      await processor.process(mockTranscribeResponse);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete from S3:'),
      );
    });

    it('should handle 404 delete error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: mockS3Result });
      const notFoundError = { response: { status: 404 } };
      mockedAxios.delete.mockRejectedValue(notFoundError);
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(mockTranscribeResponse);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete from S3:'),
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed response data', async () => {
      const malformedResponse = {
        message_type: 'transcribe_and_summarize_response',
        // Missing chat_id
      } as any;

      chatService.getChatByIdForServiceCall.mockResolvedValue(null as any);

      await processor.process(malformedResponse);

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        undefined,
      );
    });

    it('should handle very large S3 result', async () => {
      const largeResult = {
        transcription: 'A'.repeat(100000), // 100KB string
        summary: 'B'.repeat(50000), // 50KB string
      };

      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      mockedAxios.get.mockResolvedValue({ data: largeResult });
      mockedAxios.delete.mockResolvedValue({});
      chatAiService.addTranscript.mockResolvedValue(true as any);
      chatAiService.addSummary.mockResolvedValue(true as any);
      chatService.updateChat.mockResolvedValue({} as any);

      await processor.process(mockTranscribeResponse);

      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        largeResult.transcription,
      );
      expect(chatAiService.addSummary).toHaveBeenCalledWith(
        mockTranscribeResponse.chat_id,
        largeResult.summary,
      );
    });

    it('should handle circular reference in error logging', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat as any);
      const circularError: any = new Error('Circular error');
      circularError.self = circularError;
      mockedAxios.get.mockRejectedValue(circularError);

      await expect(processor.process(mockTranscribeResponse)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
