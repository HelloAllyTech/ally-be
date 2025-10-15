import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { OzonetelService } from '../ozonetel.service';
import { ChatService } from '../../../chat/service/chat.service';
import { UserService } from '../../../user/user.service';
import { CloudTelephonyService } from '../cloud-telephony.service';
import { AppConfigService } from '../../../config/config.service';
import { AiEventService } from '../../../ai/service/ai-event.service';
import { BroadcastMessageService } from '../../../audio/service/broadcast-message.service';
import { AudioRetryProducer } from '../../producer/audio-retry.producer';
import {
  AudioChatProvider,
  CloudTelephonyProvider,
} from '../../../common/constants/chat.constants';
import { MessageBrokerChannel } from '../../../common/constants/message-broker.constants';
import { UserRole } from '../../../common/constants/user.constants';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from '../../../common/entities/chat.entity';
import {
  OzonetelCallAction,
  OzonetelCallDetails,
  OzonetelCallEventsDto,
  OzonetelCallStatus,
  OzonetelEventTypes,
} from '../../type/ozonetel.type';
import { checkAudioFileReady } from '../../../common/util/audio.util';
import {
  addDurationToDate,
  convertIstStringToUtc,
  subtractDurationFromDate,
} from '../../../common/util/date.util';
import { PermissionValidator } from 'src/auth/service/permission-validator.service';

// Mock external dependencies
jest.mock('axios');
jest.mock('../../../common/util/audio.util');
jest.mock('../../../common/util/date.util');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedCheckAudioFileReady = checkAudioFileReady as jest.MockedFunction<
  typeof checkAudioFileReady
>;
const mockedConvertIstStringToUtc =
  convertIstStringToUtc as jest.MockedFunction<typeof convertIstStringToUtc>;
const mockedAddDurationToDate = addDurationToDate as jest.MockedFunction<
  typeof addDurationToDate
>;
const mockedSubtractDurationFromDate =
  subtractDurationFromDate as jest.MockedFunction<
    typeof subtractDurationFromDate
  >;

describe('OzonetelService', () => {
  let service: OzonetelService;
  let chatService: jest.Mocked<ChatService>;
  let userService: jest.Mocked<UserService>;
  let cloudTelephonyService: jest.Mocked<CloudTelephonyService>;
  let aiEventService: jest.Mocked<AiEventService>;
  let broadcastMessageService: jest.Mocked<BroadcastMessageService>;
  let audioRetryProducer: jest.Mocked<AudioRetryProducer>;
  let permissionValidatorService: jest.Mocked<PermissionValidator>;
  const mockCloudTelephonyIntegration = {
    id: 'integration-id-123',
    provider: CloudTelephonyProvider.OZONETEL,
    credentials: {
      apiKey: 'test-api-key',
      username: 'test-username',
    },
    code: 'TEST_CODE',
    tenantId: 'tenant-123',
    config: {},
    status: 'ACTIVE' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCounselor = {
    id: 1,
    role: UserRole.COUNSELOR,
    tenantId: 'tenant-123',
    externalId: 'agent-123',
    email: 'test@example.com',
    name: 'Test Counselor',
    status: 'ACTIVE' as any,
    username: 'testuser',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  const mockChat: Chat = {
    id: 1,
    status: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    externalId: 'monitor-ucid-123',
    counselorId: 1,
    provider: AudioChatProvider.OZONETEL,
    roomId: 1,
    clientId: 1,
    tenantId: 'tenant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  const mockCallDetail: OzonetelCallDetails = {
    AgentID: 'agent-123',
    monitorUCID: 'monitor-ucid-123',
    StartTime: '2024-01-01 10:00:00',
    Duration: '00:05:30',
    EndTime: '2024-01-01 10:05:30',
    Apikey: 'test-api-key',
    Status: OzonetelCallStatus.Answered,
    TimeToAnswer: '00:00:10',
    AudioFile: 'https://example.com/audio.wav',
  };

  const mockCallEventsData: OzonetelCallEventsDto = {
    eventType: OzonetelEventTypes.Call,
    data: {
      action: OzonetelCallAction.Answered,
      agent_id: 'agent-123',
      monitor_ucid: 'monitor-ucid-123',
      event_time: '2024-01-01 10:00:00',
    },
  };

  beforeEach(async () => {
    const mockChatService = {
      getChatByExternalId: jest.fn(),
      createChatForAnonymousClient: jest.fn(),
      endChat: jest.fn(),
      updateCallMetadata: jest.fn(),
      updateChat: jest.fn(),
    };

    const mockUserService = {
      getUserByExternalId: jest.fn(),
    };

    const mockCloudTelephonyService = {
      getCloudTelephonyIntegrationByCode: jest.fn(),
      getCloudTelephonyIntegrationByTenantId: jest.fn(),
      updateCloudTelephonyIntegration: jest.fn(),
    };

    const mockConfigService = {
      ozonetel: {
        apiUrl: 'https://api.ozonetel.com',
      },
      api: {
        baseUrl: 'https://api.example.com',
      },
    };

    const mockAiEventService = {
      publishTranscribeAudioEvent: jest.fn(),
    };

    const mockBroadcastMessageService = {
      broadcastUserJoinedMessage: jest.fn(),
    };

    const mockAudioRetryProducer = {
      sendAudioFileRetryMessage: jest.fn(),
    };

    const mockPermissionValidatorService = {
      validatePermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OzonetelService,
        {
          provide: ChatService,
          useValue: mockChatService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: CloudTelephonyService,
          useValue: mockCloudTelephonyService,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AiEventService,
          useValue: mockAiEventService,
        },
        {
          provide: BroadcastMessageService,
          useValue: mockBroadcastMessageService,
        },
        {
          provide: AudioRetryProducer,
          useValue: mockAudioRetryProducer,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidatorService,
        },
      ],
    }).compile();

    service = module.get<OzonetelService>(OzonetelService);
    chatService = module.get(ChatService);
    userService = module.get(UserService);
    cloudTelephonyService = module.get(CloudTelephonyService);
    aiEventService = module.get(AiEventService);
    broadcastMessageService = module.get(BroadcastMessageService);
    audioRetryProducer = module.get(AudioRetryProducer);
    permissionValidatorService = module.get(PermissionValidator);
    // Setup default mocks
    mockedConvertIstStringToUtc.mockReturnValue(
      new Date('2024-01-01T10:00:00Z'),
    );
    mockedAddDurationToDate.mockReturnValue(new Date('2024-01-01T10:00:10Z'));
    mockedSubtractDurationFromDate.mockReturnValue(
      new Date('2024-01-01T09:55:00Z'),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processOzonetelCallDetail', () => {
    beforeEach(() => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        mockCloudTelephonyIntegration as any,
      );
      userService.getUserByExternalId.mockResolvedValue(mockCounselor);
      chatService.getChatByExternalId.mockResolvedValue(mockChat);
      mockedCheckAudioFileReady.mockResolvedValue(true);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
    });

    it('should process call detail successfully with existing chat', async () => {
      await service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE');

      expect(
        cloudTelephonyService.getCloudTelephonyIntegrationByCode,
      ).toHaveBeenCalledWith('TEST_CODE');
      expect(userService.getUserByExternalId).toHaveBeenCalledWith('agent-123');
      expect(chatService.getChatByExternalId).toHaveBeenCalledWith(
        'monitor-ucid-123',
      );
      expect(chatService.endChat).toHaveBeenCalled();
      expect(chatService.updateCallMetadata).toHaveBeenCalledWith(1, 330); // 5 minutes 30 seconds
      expect(mockedCheckAudioFileReady).toHaveBeenCalledWith(
        'https://example.com/audio.wav',
      );
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalledWith({
        message_type: 'transcribe_and_summarize_request',
        timestamp: expect.any(Number),
        audio_url: 'https://example.com/audio.wav',
        chat_id: 1,
      });
    });

    it('should create new chat when chat does not exist', async () => {
      chatService.getChatByExternalId.mockResolvedValue(null);
      chatService.createChatForAnonymousClient.mockResolvedValue(mockChat);

      await service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE');

      expect(chatService.createChatForAnonymousClient).toHaveBeenCalledWith({
        counselorId: 1,
        provider: AudioChatProvider.OZONETEL,
        startedAt: expect.any(Date),
        externalId: 'monitor-ucid-123',
        status: ChatStatus.ACTIVE,
      });
    });

    it('should handle audio file not ready scenario', async () => {
      mockedCheckAudioFileReady.mockResolvedValue(false);

      await service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE');

      expect(audioRetryProducer.sendAudioFileRetryMessage).toHaveBeenCalledWith(
        {
          audioUrl: 'https://example.com/audio.wav',
          chatId: mockChat.id,
          retryCount: 0,
        },
      );
    });

    it('should handle error gracefully when code is empty', async () => {
      // Should not throw, but log error
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, ''),
      ).resolves.not.toThrow();
    });

    it('should handle error gracefully when cloud telephony integration not found', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        null,
      );

      // Should not throw, but log error
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow();
    });

    it('should handle error gracefully when provider is not Ozonetel', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        {
          ...mockCloudTelephonyIntegration,
          provider: 'INVALID_PROVIDER' as any,
        } as any,
      );

      // Should not throw, but log error
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow();
    });

    it('should handle error gracefully when API key is invalid', async () => {
      const invalidCallDetail = {
        ...mockCallDetail,
        Apikey: 'invalid-api-key',
      };

      await expect(
        service.processOzonetelCallDetail(invalidCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Invalid API key');
    });

    it('should handle error gracefully when AgentID is missing', async () => {
      const invalidCallDetail = {
        ...mockCallDetail,
        AgentID: undefined,
      };

      await expect(
        service.processOzonetelCallDetail(invalidCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Agent ID is required');
    });

    it('should handle error gracefully when call status is not answered', async () => {
      const invalidCallDetail = {
        ...mockCallDetail,
        Status: OzonetelCallStatus.Disconnected,
      };

      await expect(
        service.processOzonetelCallDetail(invalidCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Call status: NotAnswered and duration: 330');
    });

    it('should handle error gracefully when duration is zero', async () => {
      const invalidCallDetail = {
        ...mockCallDetail,
        Duration: '00:00:00',
      };

      await expect(
        service.processOzonetelCallDetail(invalidCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Call status: Answered and duration: 0');
    });

    it('should handle error gracefully when counselor not found', async () => {
      userService.getUserByExternalId.mockResolvedValue(null);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Counselor not found');
    });

    it('should handle error gracefully when counselor role is not COUNSELOR', async () => {
      userService.getUserByExternalId.mockResolvedValue({
        ...mockCounselor,
        role: UserRole.ADMIN,
      } as any);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Counselor not found');
    });

    it('should handle error gracefully when audio file is missing', async () => {
      const invalidCallDetail = {
        ...mockCallDetail,
        AudioFile: undefined,
      };
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.processOzonetelCallDetail(invalidCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('There is no audio file');
    });

    it('should handle error gracefully when summary already processed', async () => {
      const chatWithProcessedSummary = {
        ...mockChat,
        summaryStatus: ChatSummaryStatus.SUCCESS,
      };
      chatService.getChatByExternalId.mockResolvedValue(
        chatWithProcessedSummary,
      );

      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Summary generation has already been processed');
    });

    it('should handle chat creation failure', async () => {
      chatService.getChatByExternalId.mockResolvedValue(null);
      chatService.createChatForAnonymousClient.mockResolvedValue(null);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow('Chat was not created');
    });

    it('should handle missing audio file after chat creation', async () => {
      const callDetailWithoutAudio = {
        ...mockCallDetail,
        AudioFile: undefined,
      };
      chatService.getChatByExternalId.mockResolvedValue(null);
      chatService.createChatForAnonymousClient.mockResolvedValue(mockChat);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.processOzonetelCallDetail(callDetailWithoutAudio, 'TEST_CODE'),
      ).resolves.not.toThrow('Audio file is required');
    });
  });

  describe('handleOzonetelCallEvents', () => {
    beforeEach(() => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        mockCloudTelephonyIntegration as any,
      );
      userService.getUserByExternalId.mockResolvedValue(mockCounselor);
      chatService.createChatForAnonymousClient.mockResolvedValue(mockChat);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
    });

    it('should handle answered call event successfully', async () => {
      await service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE');

      expect(
        cloudTelephonyService.getCloudTelephonyIntegrationByCode,
      ).toHaveBeenCalledWith('TEST_CODE');
      expect(userService.getUserByExternalId).toHaveBeenCalledWith('agent-123');
      expect(chatService.createChatForAnonymousClient).toHaveBeenCalledWith({
        counselorId: 1,
        provider: AudioChatProvider.OZONETEL,
        externalId: 'monitor-ucid-123',
        status: ChatStatus.ACTIVE,
        startedAt: expect.any(Date),
      });
      expect(
        broadcastMessageService.broadcastUserJoinedMessage,
      ).toHaveBeenCalledWith(
        MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
        {
          participants: [1],
          userId: 1,
          chatId: mockChat.id,
        },
      );
    });

    it('should handle disconnect call event', async () => {
      const disconnectEventData = {
        ...mockCallEventsData,
        data: {
          ...mockCallEventsData.data,
          action: OzonetelCallAction.Disconnect,
        },
      };
      chatService.getChatByExternalId.mockResolvedValue(mockChat);

      await service.handleOzonetelCallEvents(disconnectEventData, 'TEST_CODE');

      expect(chatService.getChatByExternalId).toHaveBeenCalledWith(
        'monitor-ucid-123',
      );
      expect(chatService.endChat).toHaveBeenCalled();
      expect(chatService.updateCallMetadata).toHaveBeenCalledWith(1);
    });

    it('should return early for invalid event type', async () => {
      const invalidEventData = {
        ...mockCallEventsData,
        eventType: 'InvalidEvent',
      };

      await service.handleOzonetelCallEvents(invalidEventData, 'TEST_CODE');

      expect(chatService.createChatForAnonymousClient).not.toHaveBeenCalled();
    });

    it('should return early for invalid action', async () => {
      const invalidEventData = {
        ...mockCallEventsData,
        data: {
          ...mockCallEventsData.data,
          action: 'InvalidAction',
        },
      };

      await service.handleOzonetelCallEvents(invalidEventData, 'TEST_CODE');

      expect(chatService.createChatForAnonymousClient).not.toHaveBeenCalled();
    });

    it('should handle error gracefully when code is empty', async () => {
      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, ''),
      ).resolves.not.toThrow('Code is required');
    });

    it('should handle error gracefully when cloud telephony integration not found', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        null,
      );

      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE'),
      ).resolves.not.toThrow('Cloud telephony integration not found');
    });

    it('should handle error gracefully when provider is not Ozonetel', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        {
          ...mockCloudTelephonyIntegration,
          provider: 'INVALID_PROVIDER' as any,
        } as any,
      );

      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE'),
      ).resolves.not.toThrow('Invalid cloud telephony provider');
    });

    it('should handle error gracefully when agent_id is missing', async () => {
      const invalidEventData = {
        ...mockCallEventsData,
        data: {
          ...mockCallEventsData.data,
          agent_id: undefined,
        },
      };

      await expect(
        service.handleOzonetelCallEvents(invalidEventData, 'TEST_CODE'),
      ).resolves.not.toThrow('Call events: Agent id is required');
    });

    it('should handle error gracefully when counselor not found', async () => {
      userService.getUserByExternalId.mockResolvedValue(null);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE'),
      ).resolves.not.toThrow('Counselor not found');
    });

    it('should handle error gracefully when counselor role is not COUNSELOR', async () => {
      userService.getUserByExternalId.mockResolvedValue({
        ...mockCounselor,
        role: UserRole.ADMIN,
      } as any);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE'),
      ).resolves.not.toThrow('Counselor not found');
    });

    it('should handle error gracefully for invalid action', async () => {
      const invalidEventData = {
        ...mockCallEventsData,
        data: {
          ...mockCallEventsData.data,
          action: 'InvalidAction',
        },
      };
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await expect(
        service.handleOzonetelCallEvents(invalidEventData, 'TEST_CODE'),
      ).resolves.not.toThrow('Invalid action');
    });
  });

  describe('makeRequest', () => {
    it('should make successful request', async () => {
      const mockResponse = { data: { success: true } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.makeRequest({
        endpoint: 'test-endpoint',
        method: 'POST',
        data: { test: 'data' },
        headers: { 'Custom-Header': 'value' },
      });

      expect(mockedAxios).toHaveBeenCalledWith({
        url: 'https://api.ozonetel.com/test-endpoint',
        method: 'POST',
        data: { test: 'data' },
        headers: {
          'Content-Type': 'application/json',
          'Custom-Header': 'value',
        },
      });
      expect(result).toEqual({ success: true });
    });

    it('should handle request error', async () => {
      const mockError = new Error('Request failed');
      (mockedAxios as any).mockRejectedValue(mockError);

      await expect(
        service.makeRequest({
          endpoint: 'test-endpoint',
          method: 'POST',
          data: { test: 'data' },
        }),
      ).rejects.toThrow('Request failed');
    });

    it('should make request without custom headers', async () => {
      const mockResponse = { data: { success: true } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      await service.makeRequest({
        endpoint: 'test-endpoint',
        method: 'GET',
        data: {},
      });

      expect(mockedAxios).toHaveBeenCalledWith({
        url: 'https://api.ozonetel.com/test-endpoint',
        method: 'GET',
        data: {},
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
  });

  describe('subscribeOzonetelEvents', () => {
    beforeEach(() => {
      cloudTelephonyService.getCloudTelephonyIntegrationByTenantId.mockResolvedValue(
        mockCloudTelephonyIntegration as any,
      );
      (mockedAxios as any).mockResolvedValue({ data: { success: true } });
    });

    it('should subscribe to ozonetel events successfully', async () => {
      const result = await service.subscribeOzonetelEvents('tenant-123');

      expect(
        cloudTelephonyService.getCloudTelephonyIntegrationByTenantId,
      ).toHaveBeenCalledWith('tenant-123');
      expect(mockedAxios).toHaveBeenCalledWith({
        url: 'https://api.ozonetel.com/events/subscribe',
        method: 'POST',
        data: {
          callEventsURL:
            'https://api.example.com/api/v1/webhook/ozonetel/call-events?code=TEST_CODE',
          agentEventsURL: '',
        },
        headers: {
          'Content-Type': 'application/json',
          api_key: 'test-api-key',
          username: 'test-username',
        },
      });
      expect(
        cloudTelephonyService.updateCloudTelephonyIntegration,
      ).toHaveBeenCalledWith('integration-id-123', {
        config: {
          callEventsEnabled: true,
        },
      });
      expect(result).toBe(true);
    });

    it('should throw NotFoundException when integration not found', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByTenantId.mockResolvedValue(
        null,
      );

      await expect(
        service.subscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.subscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow('Cloud telephony integration not found');
    });

    it('should throw ServiceUnavailableException when request fails', async () => {
      (mockedAxios as any).mockRejectedValue(new Error('API Error'));

      await expect(
        service.subscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(
        service.subscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow('Ozonetel service unavailable');
    });
  });

  describe('unsubscribeOzonetelEvents', () => {
    beforeEach(() => {
      cloudTelephonyService.getCloudTelephonyIntegrationByTenantId.mockResolvedValue(
        mockCloudTelephonyIntegration as any,
      );
      (mockedAxios as any).mockResolvedValue({ data: { success: true } });
    });

    it('should unsubscribe from ozonetel events successfully', async () => {
      const result = await service.unsubscribeOzonetelEvents('tenant-123');

      expect(
        cloudTelephonyService.getCloudTelephonyIntegrationByTenantId,
      ).toHaveBeenCalledWith('tenant-123');
      expect(mockedAxios).toHaveBeenCalledWith({
        url: 'https://api.ozonetel.com/events/un-subscribe',
        method: 'POST',
        data: {
          eventType: OzonetelEventTypes.Call,
        },
        headers: {
          'Content-Type': 'application/json',
          api_key: 'test-api-key',
          username: 'test-username',
        },
      });
      expect(
        cloudTelephonyService.updateCloudTelephonyIntegration,
      ).toHaveBeenCalledWith('integration-id-123', {
        config: {
          callEventsEnabled: false,
        },
      });
      expect(result).toBe(true);
    });

    it('should throw NotFoundException when integration not found', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByTenantId.mockResolvedValue(
        null,
      );

      await expect(
        service.unsubscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.unsubscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow('Cloud telephony integration not found');
    });

    it('should throw ServiceUnavailableException when request fails', async () => {
      (mockedAxios as any).mockRejectedValue(new Error('API Error'));

      await expect(
        service.unsubscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow(ServiceUnavailableException);
      await expect(
        service.unsubscribeOzonetelEvents('tenant-123'),
      ).rejects.toThrow('Ozonetel service unavailable');
    });
  });

  describe('parseTimeToSeconds', () => {
    it('should parse time string to seconds correctly', () => {
      expect(service.parseTimeToSeconds('01:30:45')).toBe(5445); // 1*3600 + 30*60 + 45
      expect(service.parseTimeToSeconds('00:05:30')).toBe(330); // 5*60 + 30
      expect(service.parseTimeToSeconds('00:00:10')).toBe(10);
      expect(service.parseTimeToSeconds('02:15:00')).toBe(8100); // 2*3600 + 15*60
    });

    it('should handle zero values', () => {
      expect(service.parseTimeToSeconds('00:00:00')).toBe(0);
    });

    it('should handle large values', () => {
      expect(service.parseTimeToSeconds('23:59:59')).toBe(86399); // 23*3600 + 59*60 + 59
    });
  });

  describe('getConversationStartTime', () => {
    it('should return start time with time to answer when startTime and timeToAnswer are provided', () => {
      const result = service.getConversationStartTime({
        startTime: '2024-01-01 10:00:00',
        durationInSeconds: 300,
        endTime: '2024-01-01 10:05:00',
        timeToAnswer: 10,
      });

      expect(mockedConvertIstStringToUtc).toHaveBeenCalledWith(
        '2024-01-01 10:00:00',
      );
      expect(mockedAddDurationToDate).toHaveBeenCalledWith({
        date: expect.any(Date),
        duration: 10,
        unit: 'second',
      });
      expect(result).toEqual(expect.any(Date));
    });

    it('should return calculated start time from end time and duration when startTime is not provided', () => {
      const result = service.getConversationStartTime({
        startTime: undefined,
        durationInSeconds: 300,
        endTime: '2024-01-01 10:05:00',
        timeToAnswer: 0,
      });

      expect(mockedConvertIstStringToUtc).toHaveBeenCalledWith(
        '2024-01-01 10:05:00',
      );
      expect(mockedSubtractDurationFromDate).toHaveBeenCalledWith({
        date: expect.any(Date),
        duration: 300,
        unit: 'second',
      });
      expect(result).toEqual(expect.any(Date));
    });

    it('should return current time when neither startTime nor endTime are provided', () => {
      const result = service.getConversationStartTime({
        startTime: undefined,
        durationInSeconds: 0,
        endTime: undefined,
        timeToAnswer: 0,
      });

      expect(result).toEqual(expect.any(Date));
    });

    it('should return current time when timeToAnswer is 0 and no endTime', () => {
      const result = service.getConversationStartTime({
        startTime: '2024-01-01 10:00:00',
        durationInSeconds: 0,
        endTime: undefined,
        timeToAnswer: 0,
      });

      expect(result).toEqual(expect.any(Date));
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully in processOzonetelCallDetail', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw, but log error
      await expect(
        service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE'),
      ).resolves.not.toThrow();
    });

    it('should handle errors gracefully in handleOzonetelCallEvents', async () => {
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw, but log error
      await expect(
        service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE'),
      ).resolves.not.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete flow from call events to call detail processing', async () => {
      // First, handle call events (call answered)
      cloudTelephonyService.getCloudTelephonyIntegrationByCode.mockResolvedValue(
        mockCloudTelephonyIntegration as any,
      );
      userService.getUserByExternalId.mockResolvedValue(mockCounselor);
      chatService.createChatForAnonymousClient.mockResolvedValue(mockChat);
      permissionValidatorService.validatePermissions.mockResolvedValue(true);
      await service.handleOzonetelCallEvents(mockCallEventsData, 'TEST_CODE');

      expect(chatService.createChatForAnonymousClient).toHaveBeenCalled();
      expect(
        broadcastMessageService.broadcastUserJoinedMessage,
      ).toHaveBeenCalled();

      // Then, process call detail
      chatService.getChatByExternalId.mockResolvedValue(mockChat);
      mockedCheckAudioFileReady.mockResolvedValue(true);

      await service.processOzonetelCallDetail(mockCallDetail, 'TEST_CODE');

      expect(chatService.endChat).toHaveBeenCalled();
      expect(aiEventService.publishTranscribeAudioEvent).toHaveBeenCalled();
    });
  });
});
