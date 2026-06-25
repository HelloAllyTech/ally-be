import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { ChatTranscriptService } from '../chat-transcript.service';
import { ChatAiService } from '../chat-ai-service';
import { ChatService } from '../chat.service';
import { AppConfigService } from 'src/config/config.service';
import { Chat, ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';
import { CallDetailsService } from '../call-details.service';
import { NotificationService } from '../../../notification/service/notification.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ChatTranscriptService', () => {
  let service: ChatTranscriptService;
  let chatAiService: jest.Mocked<ChatAiService>;
  let chatService: jest.Mocked<ChatService>;

  const chatId = 1;

  const mockChat: Chat = {
    id: chatId,
    clientId: 1,
    counselorId: 2,
    status: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    startedAt: new Date(),
    endedAt: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
    archivedAt: undefined,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatTranscriptService,
        {
          provide: ChatAiService,
          useValue: {
            addTranscript: jest.fn(),
            addSummary: jest.fn(),
            sendSummaryReadyEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChatService,
          useValue: {
            getChatByIdForServiceCall: jest.fn(),
            updateChat: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            isDevelopment: false,
          },
        },
        {
          provide: CallDetailsService,
          useValue: {
            fillAiCustomFields: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            notifyTranscriptionFailure: jest.fn(),
            notifyTranscriptStored: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ChatTranscriptService);
    chatAiService = module.get(ChatAiService) as jest.Mocked<ChatAiService>;
    chatService = module.get(ChatService) as jest.Mocked<ChatService>;

    jest.clearAllMocks();
  });

  describe('processTranscribeResult', () => {
    it('should propagate (for redrive) without flipping status if loading the chat errors', async () => {
      // A transient error loading the chat must not flip the row to FAILED —
      // it propagates (HTTP 5xx) so the AI side retries the idempotent result.
      const loadError = new Error('Chat not found');

      chatService.getChatByIdForServiceCall.mockRejectedValueOnce(loadError);

      await expect(
        service.processTranscribeResult({
          chatId,
          downloadPresignedUrl: 'download-url',
        }),
      ).rejects.toThrow('Chat not found');

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        chatId,
      );
      // Status is left untouched (no FAILED flip) so a retry can still succeed.
      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('should return early if chat summary already exists', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue({
        ...mockChat,
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });

      await service.processTranscribeResult({ chatId });

      expect(chatService.updateChat).not.toHaveBeenCalled();
      expect(chatAiService.addTranscript).not.toHaveBeenCalled();
      expect(chatAiService.addSummary).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('should record a categorised failure and ack (not throw) when AI reports an error', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);
      const notify = (service as any).notificationService
        .notifyTranscriptionFailure as jest.Mock;

      // Acks (resolves) so the AI side does not re-post the error.
      await expect(
        service.processTranscribeResult({
          chatId,
          error: 'AI failure',
          stage: 'summarize',
          correlationId: 'corr-1',
        }),
      ).resolves.toBeUndefined();

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: expect.objectContaining({
          error: 'AI failure',
          stage: 'summarize',
          correlationId: 'corr-1',
        }),
      });
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId,
          stage: 'summarize',
          reason: 'AI failure',
          correlationId: 'corr-1',
          mode: 'explicit-failure',
        }),
      );
    });

    it('should process transcription and summary successfully', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          transcription: 'hello world',
          summary: 'short summary',
        },
      } as any);

      mockedAxios.delete.mockResolvedValueOnce({} as any);

      await service.processTranscribeResult({
        chatId,
        downloadPresignedUrl: 'download-url',
        deletePresignedUrl: 'delete-url',
      });

      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        'hello world',
      );

      expect(chatAiService.addSummary).toHaveBeenCalledWith(
        chatId,
        'short summary',
      );

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });

      expect(mockedAxios.delete).toHaveBeenCalledWith('delete-url');
    });

    it('should process inline transcription and summary when both are provided', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);
      mockedAxios.delete.mockResolvedValueOnce({} as any);

      const transcription = [
        {
          role: 'client',
          content: 'hello world',
          start_time: 0,
          end_time: 2,
        },
      ];
      const summary = {
        session_summary: 'short summary',
      } as any;

      await service.processTranscribeResult({
        chatId,
        transcription,
        summary,
        deletePresignedUrl: 'delete-url',
      });

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        transcription,
      );
      expect(chatAiService.addSummary).toHaveBeenCalledWith(chatId, summary);
      expect(mockedAxios.delete).toHaveBeenCalledWith('delete-url');
      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
      });
    });

    it('saves the transcript and marks the summary retryable when summary failed upstream', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);
      const notify = (service as any).notificationService
        .notifyTranscriptionFailure as jest.Mock;

      const transcription = [
        { role: 'client', content: 'hello world', start_time: 0, end_time: 2 },
      ];

      // ally-ai delivered the transcript but no summary, with a summary error.
      await service.processTranscribeResult({
        chatId,
        transcription,
        error: 'summary llm failed',
        stage: 'summarize',
        correlationId: 'corr-9',
      });

      // Transcript is persisted...
      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        transcription,
      );
      // ...summary is NOT (it failed)...
      expect(chatAiService.addSummary).not.toHaveBeenCalled();
      // ...and the chat is FAILED-but-retryable.
      expect(chatService.updateChat).toHaveBeenCalledWith(
        chatId,
        expect.objectContaining({
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: expect.objectContaining({
            summaryRetryable: true,
            summaryRetryAttempts: 0,
            correlationId: 'corr-9',
          }),
        }),
      );
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ chatId, mode: 'explicit-failure' }),
      );
    });

    it('phase 1: stores the transcript and keeps IN_PROGRESS (transcript only, no summary, no error)', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);
      const notify = (service as any).notificationService
        .notifyTranscriptionFailure as jest.Mock;
      const notifyStored = (service as any).notificationService
        .notifyTranscriptStored as jest.Mock;

      const transcription = [
        { role: 'client', content: 'hello world', start_time: 0, end_time: 2 },
      ];

      // ally-ai delivered ONLY the transcript (phase 1); summary still pending.
      await service.processTranscribeResult({
        chatId,
        transcription,
        correlationId: 'corr-1',
      });

      // Transcript is saved...
      expect(chatAiService.addTranscript).toHaveBeenCalledWith(
        mockChat,
        transcription,
      );
      // ...summary is not touched...
      expect(chatAiService.addSummary).not.toHaveBeenCalled();
      // ...the chat stays IN_PROGRESS (NOT failed) and is flagged transcriptReady.
      expect(chatService.updateChat).toHaveBeenCalledWith(
        chatId,
        expect.objectContaining({
          summaryStatus: ChatSummaryStatus.IN_PROGRESS,
          metadata: expect.objectContaining({ transcriptReady: true }),
        }),
      );
      // ...and no failure alert is raised for a normal phase-1 delivery.
      expect(notify).not.toHaveBeenCalled();
      // ...but a confirmation ping IS sent that the transcript is stored.
      expect(notifyStored).toHaveBeenCalledWith(
        expect.objectContaining({ chatId, messageCount: 1 }),
      );
    });

    it('should mark chat as FAILED if S3 download fails', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);
      mockedAxios.get.mockRejectedValueOnce(new Error('S3 error'));

      await expect(
        service.processTranscribeResult({
          chatId,
          downloadPresignedUrl: 'download-url',
        }),
      ).rejects.toThrow('S3 download failed');

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: expect.any(Object),
      });
    });
  });

  describe('deleteFromS3', () => {
    it('should not throw if delete fails', async () => {
      mockedAxios.delete.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(
        service['deleteFromS3']('delete-url'),
      ).resolves.not.toThrow();
    });
  });
});
