import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { ChatTranscriptService } from '../chat-transcript.service';
import { ChatAiService } from '../chat-ai-service';
import { ChatService } from '../chat.service';
import { AppConfigService } from 'src/config/config.service';
import { Chat, ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';
import { FailedDependencyException } from 'src/exception/custom.exception';

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
      ],
    }).compile();

    service = module.get(ChatTranscriptService);
    chatAiService = module.get(ChatAiService) as jest.Mocked<ChatAiService>;
    chatService = module.get(ChatService) as jest.Mocked<ChatService>;

    jest.clearAllMocks();
  });

  describe('processTranscribeResult', () => {
    it('should mark chat as FAILED and rethrow if chat is not found', async () => {
      const notFoundError = new Error('Chat not found');

      chatService.getChatByIdForServiceCall.mockRejectedValueOnce(
        notFoundError,
      );

      await expect(
        service.processTranscribeResult({
          chatId,
          downloadPresignedUrl: 'download-url',
        }),
      ).rejects.toThrow('Chat not found');

      expect(chatService.getChatByIdForServiceCall).toHaveBeenCalledWith(
        chatId,
      );

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: expect.objectContaining({
          error: notFoundError,
        }),
      });

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

    it('should throw FailedDependencyException if error is received', async () => {
      chatService.getChatByIdForServiceCall.mockResolvedValue(mockChat);

      await expect(
        service.processTranscribeResult({
          chatId,
          error: 'AI failure',
        }),
      ).rejects.toBeInstanceOf(FailedDependencyException);

      expect(chatService.updateChat).toHaveBeenCalledWith(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: expect.any(Object),
      });
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
