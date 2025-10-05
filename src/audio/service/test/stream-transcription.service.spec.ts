import { Test, TestingModule } from '@nestjs/testing';
import { StreamTranscriptionService } from '../stream-transcripton.service';
import { AiService } from '../../../ai/service/ai.service';
import { ChatService } from '../../../chat/service/chat.service';
import { MessageBrokerService } from '../../../message-broker/service/message-broker.service';
import { AppConfigService } from '../../../config/config.service';
import { TranscriptionService } from '../../../ai/service/transcription.service';
import { BroadcastMessageService } from '../broadcast-message.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { ANONYMOUS_CLIENT_ID } from '../../../common/constants/user.constants';
import { AudioChatProvider } from '../../../common/constants/chat.constants';
import { MessageType } from '../../../common/entities/message.entity';

// Mock the static class
jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
    getCurrentContext: jest.fn(),
    setAuthContext: jest.fn(),
    runWithContext: jest.fn((callback) => callback()),
  },
}));

// Mock the utility function
jest.mock('../../../common/util/chat-types.util', () => ({
  findMessageBrokerChannelUsingProvider: jest.fn(() => 'test-channel'),
}));

// Mock the async utility
jest.mock('src/common/util/async.util', () => ({
  processSequentially: jest.fn((items, callback) =>
    Promise.all(items.map(callback)),
  ),
}));

describe('StreamTranscriptionService', () => {
  let service: StreamTranscriptionService;
  let aiService: jest.Mocked<AiService>;
  let chatService: jest.Mocked<ChatService>;
  let messageBrokerService: jest.Mocked<MessageBrokerService>;
  let transcriptionService: jest.Mocked<TranscriptionService>;
  let broadcastMessageService: jest.Mocked<BroadcastMessageService>;

  const mockSession = {
    id: 'session-123',
    userId: 456,
    role: 'counselor',
    tenantId: 'tenant-123',
    provider: AudioChatProvider.WEBRTC,
    chatId: 789,
    type: 'user' as const,
    user: null,
    room: 'user-456',
  };

  const mockSpeakerSegments = [
    { speaker: 0, word: 'Hello' },
    { speaker: 1, word: 'Hi' },
    { speaker: 0, word: 'How' },
    { speaker: 0, word: 'are' },
    { speaker: 0, word: 'you' },
  ];

  const mockMessage = {
    id: 1,
    chatId: 789,
    type: MessageType.TEXT,
    content: 'Hello',
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: 'tenant-123',
  };

  beforeEach(async () => {
    const mockAiService = {
      identifySpeakersFromConversation: jest.fn(),
    };

    const mockChatService = {
      saveMessage: jest.fn(),
      triggerNudge: jest.fn(),
      getMessageObject: jest.fn(),
    };

    const mockMessageBrokerService = {
      publish: jest.fn(),
    };

    const mockConfig = {
      ai: { sentenceCompletionRequired: true },
    };

    const mockTranscriptionService = {
      startLiveTranscription: jest.fn(),
      sendAudio: jest.fn(),
      stopLiveTranscription: jest.fn(),
    };

    const mockBroadcastMessageService = {
      broadcastUserJoinedMessage: jest.fn(),
      broadcastAudioStreamMessage: jest.fn(),
      broadcastUserDisconnectedMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamTranscriptionService,
        { provide: AiService, useValue: mockAiService },
        { provide: ChatService, useValue: mockChatService },
        { provide: MessageBrokerService, useValue: mockMessageBrokerService },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: TranscriptionService, useValue: mockTranscriptionService },
        {
          provide: BroadcastMessageService,
          useValue: mockBroadcastMessageService,
        },
      ],
    }).compile();

    service = module.get<StreamTranscriptionService>(
      StreamTranscriptionService,
    );
    aiService = module.get(AiService);
    chatService = module.get(ChatService);
    messageBrokerService = module.get(MessageBrokerService);
    transcriptionService = module.get(TranscriptionService);
    broadcastMessageService = module.get(BroadcastMessageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addConversationSpeakers', () => {
    it('should return early when chat history is insufficient', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        {
          speakerSegments: [{ speaker: 0, word: 'Hello' }],
          createdAt: new Date(),
        },
      ];

      await service.addConversationSpeakers(mockSession);

      expect(aiService.identifySpeakersFromConversation).not.toHaveBeenCalled();
    });

    it('should return early when speakers are not identified', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
      ];

      aiService.identifySpeakersFromConversation.mockResolvedValue(null as any);

      await service.addConversationSpeakers(mockSession);

      expect(aiService.identifySpeakersFromConversation).toHaveBeenCalled();
    });

    it('should return early when both speakers are unknown', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
      ];

      aiService.identifySpeakersFromConversation.mockResolvedValue({
        speaker0: 'unknown',
        speaker1: 'unknown',
      });

      await service.addConversationSpeakers(mockSession);

      expect(aiService.identifySpeakersFromConversation).toHaveBeenCalled();
    });

    it('should assume speaker1 when speaker0 is identified', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
      ];

      aiService.identifySpeakersFromConversation.mockResolvedValue({
        speaker0: 'client',
        speaker1: 'unknown',
      });

      await service.addConversationSpeakers(mockSession);

      expect((service as any).speakers[mockSession.id]).toEqual([
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
        { id: 456, role: 'counselor' },
      ]);
    });

    it('should assume speaker0 when speaker1 is identified', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
      ];

      aiService.identifySpeakersFromConversation.mockResolvedValue({
        speaker0: 'unknown',
        speaker1: 'client',
      });

      await service.addConversationSpeakers(mockSession);

      expect((service as any).speakers[mockSession.id]).toEqual([
        { id: 456, role: 'counselor' },
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
      ]);
    });

    it('should identify speakers successfully', async () => {
      (service as any).chatBuffer[mockSession.id] = [
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
        { speakerSegments: mockSpeakerSegments, createdAt: new Date() },
      ];

      aiService.identifySpeakersFromConversation.mockResolvedValue({
        speaker0: 'client',
        speaker1: 'counselor',
      });

      await service.addConversationSpeakers(mockSession);

      expect((service as any).speakers[mockSession.id]).toEqual([
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
        { id: 456, role: 'counselor' },
      ]);
    });
  });

  describe('combineConsecutiveSpeakerSegments', () => {
    it('should combine consecutive segments from same speaker', () => {
      const segments = [
        { speaker: 0, word: 'Hello' },
        { speaker: 0, word: 'world' },
        { speaker: 1, word: 'Hi' },
        { speaker: 1, word: 'there' },
      ];

      const result = service.combineConsecutiveSpeakerSegments(segments);

      expect(result).toEqual([
        { speaker: 0, content: 'Hello world' },
        { speaker: 1, content: 'Hi there' },
      ]);
    });

    it('should handle single segments', () => {
      const segments = [
        { speaker: 0, word: 'Hello' },
        { speaker: 1, word: 'Hi' },
      ];

      const result = service.combineConsecutiveSpeakerSegments(segments);

      expect(result).toEqual([
        { speaker: 0, content: 'Hello' },
        { speaker: 1, content: 'Hi' },
      ]);
    });
  });

  describe('saveMessageAndTriggerNudge', () => {
    it('should save message and trigger nudge for counselor', async () => {
      const segment = { speaker: 0, content: 'Hello' };
      const createdAt = new Date();

      (service as any).speakers[mockSession.id] = [
        { id: 456, role: 'counselor' },
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
      ];

      chatService.saveMessage.mockResolvedValue(mockMessage);
      chatService.triggerNudge.mockResolvedValue(undefined);

      await service.saveMessageAndTriggerNudge(
        segment,
        mockSession,
        789,
        createdAt,
      );

      expect(chatService.saveMessage).toHaveBeenCalledWith(789, 456, {
        content: 'Hello',
        createdAt,
      });
      expect(chatService.triggerNudge).toHaveBeenCalled();
    });

    it('should save message without triggering nudge for client', async () => {
      const segment = { speaker: 1, content: 'Hi' };
      const createdAt = new Date();

      (service as any).speakers[mockSession.id] = [
        { id: 456, role: 'counselor' },
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
      ];

      chatService.saveMessage.mockResolvedValue(mockMessage);

      await service.saveMessageAndTriggerNudge(
        segment,
        mockSession,
        789,
        createdAt,
      );

      expect(chatService.saveMessage).toHaveBeenCalledWith(
        789,
        ANONYMOUS_CLIENT_ID,
        {
          content: 'Hi',
          createdAt,
        },
      );
      expect(chatService.triggerNudge).not.toHaveBeenCalled();
    });
  });

  describe('handleDeepgramTranscript', () => {
    it('should return early when no speaker segments', async () => {
      const metadata = {
        speakerSegments: [],
        isFinal: false,
        isSentenceComplete: false,
        currentTranscriptBuffer: '',
        currentTranscriptCreatedAt: new Date(),
      };

      await service.handleDeepgramTranscript(
        mockSession,
        789,
        'test transcript',
        metadata,
      );

      expect(messageBrokerService.publish).not.toHaveBeenCalled();
    });

    it('should return early when speaker segments filtered out', async () => {
      const metadata = {
        speakerSegments: [{ speaker: 2, word: 'Hello' }], // speaker > 1
        isFinal: false,
        isSentenceComplete: false,
        currentTranscriptBuffer: '',
        currentTranscriptCreatedAt: new Date(),
      };

      await service.handleDeepgramTranscript(
        mockSession,
        789,
        'test transcript',
        metadata,
      );

      expect(messageBrokerService.publish).not.toHaveBeenCalled();
    });

    it('should add to chat buffer when sentence complete and no speakers', async () => {
      const metadata = {
        isSentenceComplete: true,
        speakerSegments: mockSpeakerSegments,
        currentTranscriptCreatedAt: new Date(),
        isFinal: false,
        currentTranscriptBuffer: '',
      };

      await service.handleDeepgramTranscript(
        mockSession,
        789,
        'test transcript',
        metadata,
      );

      expect((service as any).chatBuffer[mockSession.id]).toHaveLength(1);
    });

    it('should broadcast message when speakers are identified', async () => {
      const metadata = {
        isSentenceComplete: false,
        speakerSegments: mockSpeakerSegments,
        isFinal: true,
        currentTranscriptBuffer: '',
        currentTranscriptCreatedAt: new Date(),
      };

      (service as any).speakers[mockSession.id] = [
        { id: 456, role: 'counselor' },
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
      ];

      chatService.getMessageObject.mockResolvedValue(mockMessage);

      await service.handleDeepgramTranscript(
        mockSession,
        789,
        'test transcript',
        metadata,
      );

      expect(messageBrokerService.publish).toHaveBeenCalled();
    });

    it('should save messages when sentence completion required', async () => {
      const metadata = {
        isSentenceComplete: true,
        speakerSegments: mockSpeakerSegments,
        currentTranscriptCreatedAt: new Date(),
        isFinal: false,
        currentTranscriptBuffer: '',
      };

      (service as any).speakers[mockSession.id] = [
        { id: 456, role: 'counselor' },
        { id: ANONYMOUS_CLIENT_ID, role: 'client' },
      ];

      chatService.saveMessage.mockResolvedValue(mockMessage);

      await service.handleDeepgramTranscript(
        mockSession,
        789,
        'test transcript',
        metadata,
      );

      expect(chatService.saveMessage).toHaveBeenCalled();
    });
  });

  describe('startLiveTranscription', () => {
    it('should handle error during transcription start', async () => {
      const error = new Error('Transcription failed');
      transcriptionService.startLiveTranscription.mockRejectedValue(error);

      await service.startLiveTranscription(mockSession, {});

      expect(transcriptionService.startLiveTranscription).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastUserJoinedMessage,
      ).toHaveBeenCalled();
    });

    it('should start live transcription successfully', async () => {
      transcriptionService.startLiveTranscription.mockResolvedValue(undefined);

      await service.startLiveTranscription(mockSession, {});

      expect(transcriptionService.startLiveTranscription).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastUserJoinedMessage,
      ).toHaveBeenCalled();
    });
  });

  describe('transcribeAudioData', () => {
    it('should transcribe audio and broadcast for non-anonymous user', () => {
      const audioData = Buffer.from('test audio').toString('base64');

      service.transcribeAudioData(mockSession, audioData, true);

      expect(transcriptionService.sendAudio).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastAudioStreamMessage,
      ).toHaveBeenCalled();
    });

    it('should transcribe audio without broadcasting for anonymous user', () => {
      const anonymousSession = { ...mockSession, userId: -1 };
      const audioData = Buffer.from('test audio').toString('base64');

      service.transcribeAudioData(anonymousSession, audioData, true);

      expect(transcriptionService.sendAudio).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastAudioStreamMessage,
      ).not.toHaveBeenCalled();
    });

    it('should transcribe audio without broadcasting when shouldBroadcastAudioMessage is false', () => {
      const audioData = Buffer.from('test audio').toString('base64');

      service.transcribeAudioData(mockSession, audioData, false);

      expect(transcriptionService.sendAudio).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastAudioStreamMessage,
      ).not.toHaveBeenCalled();
    });
  });

  describe('endLiveTranscription', () => {
    it('should end live transcription', () => {
      service.endLiveTranscription(mockSession);

      expect(transcriptionService.stopLiveTranscription).toHaveBeenCalledWith(
        mockSession,
      );
      expect(
        broadcastMessageService.broadcastUserDisconnectedMessage,
      ).toHaveBeenCalled();
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context', () => {
      service.setAuthContext(mockSession);

      expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
        '456',
        'counselor',
        'tenant-123',
      );
    });
  });
});
