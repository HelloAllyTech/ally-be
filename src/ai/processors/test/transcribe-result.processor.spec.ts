import { Test, TestingModule } from '@nestjs/testing';

import { TranscribeResultProcessor } from '../transcribe-result.processor';
import { ChatTranscriptService } from '../../../chat/service/chat-transcript.service';
import { AppConfigService } from 'src/config/config.service';
import { TranscribeAndSummarizeResponseMessage } from '../../dto/transcribe-and-summarize-response.model';

describe('TranscribeResultProcessor', () => {
  let processor: TranscribeResultProcessor;
  let chatTranscriptService: jest.Mocked<ChatTranscriptService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscribeResultProcessor,
        {
          provide: ChatTranscriptService,
          useValue: {
            processTranscribeResult: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {},
        },
      ],
    }).compile();

    processor = module.get(TranscribeResultProcessor);
    chatTranscriptService = module.get(
      ChatTranscriptService,
    ) as jest.Mocked<ChatTranscriptService>;

    jest.clearAllMocks();
  });

  describe('getEventType', () => {
    it('should return transcribe_and_summarize_response', () => {
      expect(processor.getEventType()).toBe(
        'transcribe_and_summarize_response',
      );
    });
  });

  describe('process', () => {
    it('should forward event data to ChatTranscriptionService', async () => {
      const event: TranscribeAndSummarizeResponseMessage = {
        chat_id: 123,
        download_presigned_url: 'download-url',
        delete_presigned_url: 'delete-url',
        error: undefined,
        message_type: 'transcribe_and_summarize_response',
        timestamp: Date.now(),
      };

      await processor.process(event);

      expect(
        chatTranscriptService.processTranscribeResult,
      ).toHaveBeenCalledWith({
        chatId: 123,
        downloadPresignedUrl: 'download-url',
        deletePresignedUrl: 'delete-url',
        error: undefined,
      });
    });

    it('should pass error field when present', async () => {
      const event: TranscribeAndSummarizeResponseMessage = {
        chat_id: 456,
        download_presigned_url: undefined,
        delete_presigned_url: undefined,
        error: 'AI failure',
        message_type: 'transcribe_and_summarize_response',
        timestamp: Date.now(),
      };

      await processor.process(event);

      expect(
        chatTranscriptService.processTranscribeResult,
      ).toHaveBeenCalledWith({
        chatId: 456,
        downloadPresignedUrl: undefined,
        deletePresignedUrl: undefined,
        error: 'AI failure',
      });
    });

    it('should rethrow if ChatTranscriptionService throws', async () => {
      const event: TranscribeAndSummarizeResponseMessage = {
        chat_id: 789,
        download_presigned_url: 'download-url',
        delete_presigned_url: 'delete-url',
        error: undefined,
        message_type: 'transcribe_and_summarize_response',
        timestamp: Date.now(),
      };

      const serviceError = new Error('Processing failed');

      chatTranscriptService.processTranscribeResult.mockRejectedValueOnce(
        serviceError,
      );

      await expect(processor.process(event)).rejects.toThrow(
        'Processing failed',
      );

      expect(
        chatTranscriptService.processTranscribeResult,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
