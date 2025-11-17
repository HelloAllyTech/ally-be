import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CallDetailsService } from '../call-details.service';
import { CallDetailsRepository } from '../../repository/call-details.repository';
import { ChatRepository } from '../../repository/chat.repository';
import { MessageService } from '../message.service';
import { CryptoService } from '../../../common/service/crypto.service';
import { AppConfigService } from '../../../config/config.service';
import { AiService } from '../../../ai/service/ai.service';
import { RedisService } from '../../../redis/service/redis.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../../audio/service/stream-file-processor.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import {
  AudioChatProvider,
  AudioChatPlatform,
} from '../../../common/constants/chat.constants';
import { ForbiddenException } from '../../../exception/custom.exception';
import { TIME } from '../../../common/constants/time.constants';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from 'src/chat/entity/chat.entity';
import { MessageType } from 'src/chat/entity/message.entity';
import { FlattenedSummaryNotePayloadCamelCase } from 'src/chat/type/call.details.type';
import { CallDetails } from 'src/chat/entity/call.details.entity';

describe('CallDetailsService', () => {
  let service: CallDetailsService;
  let callDetailsRepository: CallDetailsRepository;
  let chatRepository: ChatRepository;
  let messageService: MessageService;
  let cryptoService: CryptoService;
  let aiService: AiService;
  let cache: RedisService;
  let broadcastMessageService: BroadcastMessageService;
  let streamFileProcessorService: StreamFileProcessorService;

  const mockChat: Chat = {
    id: 1,
    clientId: 100,
    counselorId: 200,
    status: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: new Date('2024-01-01T10:30:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'test-tenant',
    externalId: undefined,
  };

  const mockCallDetails: CallDetails = {
    id: 1,
    chatId: 1,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T10:30:00Z'),
    callDuration: 1800,
    callInfo: {
      provider: AudioChatProvider.WEBRTC,
      platform: AudioChatPlatform.WEB,
      pauseChat: false,
    },
    summary: {
      callId: '1',
      callDuration: 1800,
      callDate: '2024-01-01',
      callTime: '10:00:00',
      clientId: '100',
      counsellor: 'Test Counselor',
      callType: 'Regular',
      age: 25,
      gender: 'Male',
      profession: 'Engineer',
      relationshipStatus: 'Single',
      languages: [],
      location: 'Test City',
      codeOfConcern: 'Anxiety',
      sessionSummary: 'Test summary',
      counselingProcessFlow: 'Test flow',
      keyConcerns: 'Test concerns',
      subjectiveObservations: 'Test observations',
      objectiveObservations: 'Test objective',
      assessment: 'Test assessment',
      dominantFeelings: 'Test feelings',
      issuesWorkedOn: 'Test issues',
      keyTherapeuticTechniques: 'Test techniques',
      referralsProvided: null,
      homework: 'Test homework',
      planForNextCall: 'Test plan',
      tags: [
        { tag: 'tag1', positivity_rating: 0.8 },
        { tag: 'tag2', positivity_rating: 0.6 },
      ],
      listeningShare: 0.5,
      reflectiveQuestionsAsked: 5,
      openEndedQuestionsAsked: 3,
      emotionalLift: 'Positive',
      callQuality: 5,
      newCallFollowUp: 'Follow up notes',
    },
    noOfNudges: 2,
    noOfStages: 3,
    transcript: 'Test transcript',
    tenantId: 'test-tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMessages = [
    {
      id: 1,
      chatId: 1,
      senderId: 100,
      content: 'Hello, I need help',
      type: MessageType.TEXT,
      createdAt: new Date('2024-01-01T10:00:00Z'),
    },
    {
      id: 2,
      chatId: 1,
      senderId: 200,
      content: 'How can I assist you?',
      type: MessageType.TEXT,
      createdAt: new Date('2024-01-01T10:01:00Z'),
    },
    {
      id: 3,
      chatId: 1,
      senderId: 200,
      content: 'Test nudge content',
      type: MessageType.NUDGE,
      createdAt: new Date('2024-01-01T10:02:00Z'),
    },
    {
      id: 4,
      chatId: 1,
      senderId: 200,
      content: 'Assessment',
      type: MessageType.STAGE,
      createdAt: new Date('2024-01-01T10:03:00Z'),
    },
  ];

  beforeEach(async () => {
    // Mock ExecutionManager
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('test-tenant');
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('200');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallDetailsService,
        {
          provide: CallDetailsRepository,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: ChatRepository,
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: MessageService,
          useValue: {
            getMessageByChatId: jest.fn(),
            getChatHistoryForAIService: jest.fn(),
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
          provide: AppConfigService,
          useValue: {
            phiData: {
              phiDataEncryptionKey: 'test-key',
            },
          },
        },
        {
          provide: AiService,
          useValue: {
            generateSummaryAndTags: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            hincrBy: jest.fn(),
            hgetAll: jest.fn(),
          },
        },
        {
          provide: BroadcastMessageService,
          useValue: {
            broadcastChatEndedEvent: jest.fn(),
          },
        },
        {
          provide: StreamFileProcessorService,
          useValue: {
            endCallStream: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CallDetailsService>(CallDetailsService);
    callDetailsRepository = module.get<CallDetailsRepository>(
      CallDetailsRepository,
    );
    chatRepository = module.get<ChatRepository>(ChatRepository);
    messageService = module.get<MessageService>(MessageService);
    cryptoService = module.get<CryptoService>(CryptoService);
    aiService = module.get<AiService>(AiService);
    cache = module.get<RedisService>(RedisService);
    broadcastMessageService = module.get<BroadcastMessageService>(
      BroadcastMessageService,
    );
    streamFileProcessorService = module.get<StreamFileProcessorService>(
      StreamFileProcessorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleChatEnded', () => {
    it('should handle WEBRTC chat ended successfully', async () => {
      const webrtcCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(webrtcCallDetails as any);
      jest
        .spyOn(service, 'updateSummaryAndTags')
        .mockResolvedValue(undefined as any);
      jest
        .spyOn(service, 'updateMessageStatistics')
        .mockResolvedValue(undefined as any);

      await service.handleChatEnded(mockChat);

      expect(callDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 1, tenantId: 'test-tenant' },
      });
      expect(service.updateSummaryAndTags).toHaveBeenCalledWith(mockChat);
      expect(service.updateMessageStatistics).toHaveBeenCalledWith(
        mockChat,
        webrtcCallDetails,
      );
      expect(
        broadcastMessageService.broadcastChatEndedEvent,
      ).toHaveBeenCalled();
    });

    it('should handle MICROPHONE provider chat ended', async () => {
      const micCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.MICROPHONE },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(micCallDetails as any);

      await service.handleChatEnded(mockChat);

      expect(streamFileProcessorService.endCallStream).toHaveBeenCalledWith({
        chatId: 1,
        provider: AudioChatProvider.MICROPHONE,
      });
      expect(
        broadcastMessageService.broadcastChatEndedEvent,
      ).toHaveBeenCalled();
    });

    it('should handle EXOTEL_CONFERENCE_CALL provider', async () => {
      const exotelCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(exotelCallDetails as any);

      await service.handleChatEnded(mockChat);

      expect(streamFileProcessorService.endCallStream).toHaveBeenCalledWith({
        chatId: 1,
        provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
      });
    });

    it('should handle OZONETEL provider', async () => {
      const ozonetelCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.OZONETEL },
      };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(ozonetelCallDetails as any);

      await service.handleChatEnded(mockChat);

      expect(
        broadcastMessageService.broadcastChatEndedEvent,
      ).toHaveBeenCalled();
    });
  });

  describe('updateSummaryAndTags', () => {
    it('should update summary and tags with encryption', async () => {
      const mockSummary: FlattenedSummaryNotePayloadCamelCase = {
        callId: '1',
        callDuration: 1800,
        callDate: '2024-01-01',
        callTime: '10:00:00',
        clientId: '100',
        counsellor: 'Test Counselor',
        callType: 'Regular',
        age: 25,
        gender: 'Male',
        profession: 'Engineer',
        relationshipStatus: 'Single',
        languages: [],
        location: 'Test City',
        codeOfConcern: 'Anxiety',
        sessionSummary: 'Test summary',
        counselingProcessFlow: 'Test flow',
        keyConcerns: 'Test concerns',
        subjectiveObservations: 'Test observations',
        objectiveObservations: 'Test objective',
        assessment: 'Test assessment',
        dominantFeelings: 'Test feelings',
        issuesWorkedOn: 'Test issues',
        keyTherapeuticTechniques: 'Test techniques',
        referralsProvided: null,
        homework: 'Test homework',
        planForNextCall: 'Test plan',
        tags: [{ tag: 'tag1', positivity_rating: 0.8 }],
        listeningShare: 0.5,
        reflectiveQuestionsAsked: 5,
        openEndedQuestionsAsked: 3,
        emotionalLift: 'Positive',
        callQuality: 5,
        newCallFollowUp: 'Follow up notes',
      };

      jest.spyOn(service, 'generateSummary').mockResolvedValue(mockSummary);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateSummaryAndTags(mockChat);

      expect(service.generateSummary).toHaveBeenCalledWith(1);
      expect(cryptoService.encrypt).toHaveBeenCalledWith(
        'Test summary',
        'test-key',
      );
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        {
          summary: {
            ...mockSummary,
            sessionSummary: 'encrypted_Test summary',
          },
        },
      );
    });

    it('should handle empty summary', async () => {
      jest.spyOn(service, 'generateSummary').mockResolvedValue(undefined);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateSummaryAndTags(mockChat);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        { summary: {} },
      );
    });
  });

  describe('updateCallMetadata', () => {
    it('should update call metadata with calculated duration', async () => {
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallMetadata(mockChat as any);

      expect(callDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 1, tenantId: 'test-tenant' },
      });
      expect(callDetailsRepository.update).toHaveBeenCalled();
    });

    it('should update call metadata with provided duration', async () => {
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallMetadata(mockChat as any, 3600);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          callDuration: 3600,
        }),
      );
    });

    it('should handle call details not found', async () => {
      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      await service.updateCallMetadata(mockChat as any);

      expect(callDetailsRepository.findOne).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockRejectedValue(new Error('Database error'));

      await service.updateCallMetadata(mockChat as any);

      // Should not throw, just log error
      expect(callDetailsRepository.findOne).toHaveBeenCalled();
    });
  });

  describe('updateMessageStatistics', () => {
    it('should calculate and update message statistics', async () => {
      jest.spyOn(messageService, 'getMessageByChatId').mockResolvedValue({
        messages: mockMessages as any,
        count: mockMessages.length,
      });
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'hgetAll').mockResolvedValue({});
      jest.spyOn(cache, 'del').mockResolvedValue(undefined);

      await service.updateMessageStatistics(mockChat);

      expect(messageService.getMessageByChatId).toHaveBeenCalledWith(1, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          noOfNudges: 1,
          noOfStages: 1,
          transcript: expect.stringContaining('encrypted_'),
          callInfo: expect.objectContaining({
            clientTalkingPercentage: expect.any(Number),
            counselorTalkingPercentage: expect.any(Number),
            clientWordCount: expect.any(Number),
            counselorWordCount: expect.any(Number),
          }),
        }),
      );
      expect(cache.del).toHaveBeenCalledWith('call:1:word-count');
    });

    it('should handle word count by language', async () => {
      jest.spyOn(messageService, 'getMessageByChatId').mockResolvedValue({
        messages: mockMessages as any,
        count: mockMessages.length,
      });
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest
        .spyOn(cache, 'hgetAll')
        .mockResolvedValue({ english: '50', hindi: '30' });
      jest.spyOn(cache, 'del').mockResolvedValue(undefined);

      await service.updateMessageStatistics(mockChat);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1 },
        expect.objectContaining({
          callInfo: expect.objectContaining({
            wordCountByLanguage: { english: 50, hindi: 30 },
          }),
        }),
      );
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(messageService, 'getMessageByChatId')
        .mockRejectedValue(new Error('Database error'));

      const result = await service.updateMessageStatistics(mockChat);

      expect(result).toBeUndefined();
      expect(callDetailsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('generateSummary', () => {
    it('should generate summary from AI service', async () => {
      const mockAiResponse = {
        session_summary: 'AI generated summary',
        tags: ['tag1', 'tag2'],
        call_quality: 5,
      };

      jest
        .spyOn(messageService, 'getChatHistoryForAIService')
        .mockResolvedValue([]);
      jest
        .spyOn(aiService, 'generateSummaryAndTags')
        .mockResolvedValue(mockAiResponse as any);

      const result = await service.generateSummary(1);

      expect(messageService.getChatHistoryForAIService).toHaveBeenCalledWith(
        1,
        {
          sortBy: 'createdAt',
          order: 'ASC',
        },
      );
      expect(aiService.generateSummaryAndTags).toHaveBeenCalled();
      expect(result).toEqual({
        sessionSummary: 'AI generated summary',
        tags: ['tag1', 'tag2'],
        callQuality: 5,
      });
    });
  });

  describe('updateCallDetails', () => {
    it('should update call details with encrypted summary', async () => {
      const summary: FlattenedSummaryNotePayloadCamelCase = {
        callId: '1',
        callDuration: 1800,
        callDate: '2024-01-01',
        callTime: '10:00:00',
        clientId: '100',
        counsellor: 'Test Counselor',
        callType: 'Regular',
        age: 25,
        gender: 'Male',
        profession: 'Engineer',
        relationshipStatus: 'Single',
        languages: [],
        location: 'Test City',
        codeOfConcern: 'Anxiety',
        sessionSummary: 'Test summary',
        counselingProcessFlow: 'Test flow',
        keyConcerns: 'Test concerns',
        subjectiveObservations: 'Test observations',
        objectiveObservations: 'Test objective',
        assessment: 'Test assessment',
        dominantFeelings: 'Test feelings',
        issuesWorkedOn: 'Test issues',
        keyTherapeuticTechniques: 'Test techniques',
        referralsProvided: null,
        homework: 'Test homework',
        planForNextCall: 'Test plan',
        tags: [{ tag: 'tag1', positivity_rating: 0.8 }],
        listeningShare: 0.5,
        reflectiveQuestionsAsked: 5,
        openEndedQuestionsAsked: 3,
        emotionalLift: 'Positive',
        callQuality: 5,
        newCallFollowUp: 'Follow up notes',
      };

      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallDetails(1, summary);

      expect(cryptoService.encrypt).toHaveBeenCalledWith(
        'Test summary',
        'test-key',
      );
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          summary: {
            ...summary,
            sessionSummary: 'encrypted_Test summary',
          },
        },
      );
    });

    it('should handle summary without sessionSummary', async () => {
      const summary: any = {
        callId: '1',
        callDuration: 1800,
        callDate: '2024-01-01',
        callTime: '10:00:00',
        clientId: '100',
        counsellor: 'Test Counselor',
        callType: 'Regular',
        age: 25,
        gender: 'Male',
        profession: 'Engineer',
        relationshipStatus: 'Single',
        languages: [],
        location: 'Test City',
        codeOfConcern: 'Anxiety',
        sessionSummary: undefined,
        counselingProcessFlow: 'Test flow',
        keyConcerns: 'Test concerns',
        subjectiveObservations: 'Test observations',
        objectiveObservations: 'Test objective',
        assessment: 'Test assessment',
        dominantFeelings: 'Test feelings',
        issuesWorkedOn: 'Test issues',
        keyTherapeuticTechniques: 'Test techniques',
        referralsProvided: null,
        homework: 'Test homework',
        planForNextCall: 'Test plan',
        tags: [{ tag: 'tag1', positivity_rating: 0.8 }],
        listeningShare: 0.5,
        reflectiveQuestionsAsked: 5,
        openEndedQuestionsAsked: 3,
        emotionalLift: 'Positive',
        callQuality: 5,
        newCallFollowUp: 'Follow up notes',
      };

      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallDetails(1, summary);

      expect(cryptoService.encrypt).not.toHaveBeenCalled();
      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        { summary },
      );
    });
  });

  describe('updateCallInfo', () => {
    it('should update call info successfully', async () => {
      const callInfoDto = { summaryName: 'Updated Summary Name' };

      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);

      await service.updateCallInfo(1, callInfoDto, mockChat);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            summaryName: 'Updated Summary Name',
          },
        },
      );
    });

    it('should throw ForbiddenException when user is not authenticated', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

      await expect(
        service.updateCallInfo(1, { summaryName: 'Test' }, mockChat),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user is not the counselor', async () => {
      jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('999');

      await expect(
        service.updateCallInfo(1, { summaryName: 'Test' }, mockChat),
      ).rejects.toThrow(
        'You are not authorized to update call info for this chat',
      );
    });

    it('should throw NotFoundException when call details not found', async () => {
      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.updateCallInfo(1, { summaryName: 'Test' }, mockChat),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('incrementWordCountByLanguage', () => {
    it('should increment word count for a language', async () => {
      jest.spyOn(cache, 'hincrBy').mockResolvedValue(10);

      const result = await service.incrementWordCountByLanguage(
        1,
        'english',
        5,
      );

      expect(cache.hincrBy).toHaveBeenCalledWith(
        'call:1:word-count',
        'english',
        5,
      );
      expect(result).toBe(10);
    });
  });

  describe('decryptCallDetails', () => {
    it('should decrypt transcript and summary', async () => {
      const encryptedCallDetails = {
        ...mockCallDetails,
        transcript: 'encrypted_Test transcript',
        summary: {
          sessionSummary: 'encrypted_Test summary',
        },
      };

      const result = await service.decryptCallDetails(
        encryptedCallDetails as any,
      );

      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        'encrypted_Test transcript',
        'test-key',
      );
      expect(cryptoService.decrypt).toHaveBeenCalledWith(
        'encrypted_Test summary',
        'test-key',
      );
      expect(result?.transcript).toBe('Test transcript');
      expect(result?.summary?.sessionSummary).toBe('Test summary');
    });

    it('should return undefined for null call details', async () => {
      const result = await service.decryptCallDetails(null);

      expect(result).toBeUndefined();
    });

    it('should handle decryption errors gracefully', async () => {
      const encryptedCallDetails = {
        ...mockCallDetails,
        transcript: 'encrypted_Test transcript',
        summary: {
          sessionSummary: 'encrypted_Test summary',
        },
      };

      jest
        .spyOn(cryptoService, 'decrypt')
        .mockRejectedValue(new Error('Decryption failed'));

      const result = await service.decryptCallDetails(
        encryptedCallDetails as any,
      );

      // New behavior: keeps original data when decryption fails
      expect(result?.transcript).toBe('encrypted_Test transcript');
      expect(result?.summary?.sessionSummary).toBe('encrypted_Test summary');
    });
  });

  describe('pauseOrResumeChat', () => {
    it('should pause chat successfully', async () => {
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      await service.pauseOrResumeChat(1, true);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            pauseChat: true,
          },
        },
      );
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'true',
        TIME.DAY_IN_SECONDS,
      );
    });

    it('should resume chat successfully', async () => {
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(mockCallDetails as any);
      jest.spyOn(callDetailsRepository, 'update').mockResolvedValue({} as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      await service.pauseOrResumeChat(1, false);

      expect(callDetailsRepository.update).toHaveBeenCalledWith(
        { chatId: 1, tenantId: 'test-tenant' },
        {
          callInfo: {
            ...mockCallDetails.callInfo,
            pauseChat: false,
          },
        },
      );
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'false',
        TIME.DAY_IN_SECONDS,
      );
    });

    it('should throw NotFoundException when call details not found', async () => {
      jest.spyOn(callDetailsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.pauseOrResumeChat(1, true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isChatPaused', () => {
    it('should return cached pause status', async () => {
      jest.spyOn(cache, 'get').mockResolvedValue('true');

      const result = await service.isChatPaused(1);

      expect(result).toBe(true);
      expect(cache.get).toHaveBeenCalledWith('chat-paused-1');
      expect(callDetailsRepository.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache when not in cache', async () => {
      const pausedCallDetails = {
        ...mockCallDetails,
        callInfo: { ...mockCallDetails.callInfo, pauseChat: true },
      };

      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(pausedCallDetails as any);
      jest.spyOn(cache, 'set').mockResolvedValue(undefined);

      const result = await service.isChatPaused(1);

      expect(result).toBe(true);
      expect(callDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { chatId: 1, tenantId: 'test-tenant' },
      });
      expect(cache.set).toHaveBeenCalledWith(
        'chat-paused-1',
        'true',
        TIME.DAY_IN_SECONDS,
      );
    });

    it('should return undefined when pause status is not set', async () => {
      const unpausedCallDetails = {
        ...mockCallDetails,
        callInfo: { provider: AudioChatProvider.WEBRTC },
      };

      jest.spyOn(cache, 'get').mockResolvedValue(null);
      jest
        .spyOn(callDetailsRepository, 'findOne')
        .mockResolvedValue(unpausedCallDetails as any);

      const result = await service.isChatPaused(1);

      expect(result).toBeUndefined();
    });
  });
});
