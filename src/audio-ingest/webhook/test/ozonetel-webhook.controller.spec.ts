import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OzonetelWebhookController } from '../ozonetel-webhook.controller';
import { OzonetelService } from '../../service/ozonetel.service';
import { LoggerService } from '../../../logger/logger.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import {
  OzonetelCallDetailsBody,
  OzonetelCallDetails,
  OzonetelCallEventsDto,
  OzonetelCallStatus,
} from '../../type/ozonetel.type';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

describe('OzonetelWebhookController', () => {
  let controller: OzonetelWebhookController;
  let ozonetelService: jest.Mocked<OzonetelService>;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockOzonetelService = {
    processOzonetelCallDetail: jest.fn(),
    handleOzonetelCallEvents: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OzonetelWebhookController],
      providers: [
        {
          provide: OzonetelService,
          useValue: mockOzonetelService,
        },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<OzonetelWebhookController>(
      OzonetelWebhookController,
    );
    ozonetelService = module.get(OzonetelService);
    mockLogger = LoggerService.getInstance(
      'test',
    ) as jest.Mocked<LoggerService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Reset all mocks to their default state
    mockOzonetelService.processOzonetelCallDetail.mockReset();
    mockOzonetelService.handleOzonetelCallEvents.mockReset();
  });

  describe('handleOzonetelCallDetails', () => {
    const mockCode = 'test-code-123';
    const mockCallDetails: OzonetelCallDetails = {
      AgentID: 'agent-123',
      monitorUCID: 'monitor-456',
      AudioFile: 'https://example.com/audio.mp3',
      StartTime: '2024-01-01 10:00:00',
      Duration: '00:05:30',
      EndTime: '2024-01-01 10:05:30',
      Apikey: 'test-api-key',
      Status: OzonetelCallStatus.Answered,
      TimeToAnswer: '00:00:10',
    };

    const mockBody: OzonetelCallDetailsBody = {
      data: JSON.stringify(mockCallDetails),
    };

    it('should successfully process call details webhook', async () => {
      // Arrange
      ozonetelService.processOzonetelCallDetail.mockResolvedValue(undefined);

      // Act
      const result = await controller.handleOzonetelCallDetails(
        mockCode,
        mockBody,
      );

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Webhook processed successfully',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received Ozonetel call details webhook',
      );
      expect(ozonetelService.processOzonetelCallDetail).toHaveBeenCalledWith(
        mockCallDetails,
        mockCode,
      );
    });

    it('should handle invalid JSON in body data', async () => {
      // Arrange
      const invalidBody: OzonetelCallDetailsBody = {
        data: 'invalid-json',
      };

      // Act & Assert
      await expect(
        controller.handleOzonetelCallDetails(mockCode, invalidBody),
      ).rejects.toThrow(BadRequestException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing Ozonetel webhook with error'),
      );
    });

    it('should handle service errors and throw BadRequestException', async () => {
      // Arrange
      ozonetelService.processOzonetelCallDetail.mockImplementation(() => {
        throw new Error('Service processing failed');
      });

      // Act & Assert
      await expect(
        controller.handleOzonetelCallDetails(mockCode, mockBody),
      ).rejects.toThrow(BadRequestException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing Ozonetel webhook with error'),
      );
    });

    it('should handle various code parameter formats', async () => {
      ozonetelService.processOzonetelCallDetail.mockResolvedValue(undefined);

      // Test empty code
      const emptyCode = '';
      const resultEmpty = await controller.handleOzonetelCallDetails(
        emptyCode,
        mockBody,
      );

      expect(resultEmpty).toEqual({
        success: true,
        message: 'Webhook processed successfully',
      });
      expect(ozonetelService.processOzonetelCallDetail).toHaveBeenCalledWith(
        mockCallDetails,
        emptyCode,
      );

      // Reset mock
      ozonetelService.processOzonetelCallDetail.mockClear();
      ozonetelService.processOzonetelCallDetail.mockResolvedValue(undefined);

      // Test undefined code
      const undefinedCode = undefined as any;
      const resultUndefined = await controller.handleOzonetelCallDetails(
        undefinedCode,
        mockBody,
      );

      expect(resultUndefined).toEqual({
        success: true,
        message: 'Webhook processed successfully',
      });
      expect(ozonetelService.processOzonetelCallDetail).toHaveBeenCalledWith(
        mockCallDetails,
        undefinedCode,
      );
    });

    it('should handle complex call details data', async () => {
      // Arrange
      const complexCallDetails: OzonetelCallDetails = {
        AgentID: 'agent-789',
        AgentName: 'John Doe',
        AgentPhoneNumber: '+1234567890',
        AgentStatus: 'Available',
        AgentUniqueID: 'unique-123',
        Apikey: 'complex-api-key',
        AudioFile: 'https://example.com/complex-audio.mp3',
        CallDuration: '00:10:45',
        CallerConfAudioFile: 'https://example.com/caller-conf.mp3',
        CallerID: '+9876543210',
        CampaignName: 'Test Campaign',
        CampaignStatus: 'Active',
        Comments: 'Test call comments',
        ConfDuration: '00:08:30',
        CustomerStatus: 'Satisfied',
        DataUniqueId: 'data-unique-456',
        DialStatus: 'Connected',
        DialedNumber: '+1111111111',
        DId: 'did-123',
        Disposition: 'Completed',
        Duration: '00:10:45',
        EndTime: '2024-01-01 10:10:45',
        FallBackRule: 'Default',
        HangupBy: 'Agent',
        HoldDuration: '00:01:15',
        Location: 'Mumbai',
        monitorUCID: 'monitor-789',
        PhoneName: 'Main Phone',
        Skill: 'Customer Service',
        StartTime: '2024-01-01 10:00:00',
        Status: OzonetelCallStatus.Answered,
        TimeToAnswer: '00:00:05',
        TransferType: 'None',
        TransferredTo: '',
        Type: 'Inbound',
        UserName: 'john.doe',
        UUI: 'uui-123',
        WrapUpDuration: '00:00:30',
      };

      const complexBody: OzonetelCallDetailsBody = {
        data: JSON.stringify(complexCallDetails),
      };

      ozonetelService.processOzonetelCallDetail.mockResolvedValue(undefined);

      // Act
      const result = await controller.handleOzonetelCallDetails(
        mockCode,
        complexBody,
      );

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Webhook processed successfully',
      });
      expect(ozonetelService.processOzonetelCallDetail).toHaveBeenCalledWith(
        complexCallDetails,
        mockCode,
      );
    });
  });

  describe('handleOzonetelEventsSubscription', () => {
    const mockCode = 'test-code-456';
    const mockCallEventsData: OzonetelCallEventsDto = {
      eventType: 'Call',
      eventTime: '2024-01-01 10:00:00',
      username: 'test-user',
      data: {
        action: 'Answered',
        call_type: 'Inbound',
        ucid: 'ucid-123',
        monitor_ucid: 'monitor-456',
        agent_id: 'agent-789',
        skill: 'Customer Service',
        caller_id: '+1234567890',
        did: 'did-123',
        agent_number: '+9876543210',
        event_time: '2024-01-01 10:00:00',
      },
    };

    it('should successfully process events subscription', async () => {
      // Arrange
      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Act
      const result = await controller.handleOzonetelEventsSubscription(
        mockCode,
        mockCallEventsData,
      );

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received Ozonetel events subscription',
      );
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        mockCallEventsData,
        mockCode,
      );
    });

    it('should handle service errors and throw BadRequestException', async () => {
      // Arrange
      ozonetelService.handleOzonetelCallEvents.mockImplementation(() => {
        throw new Error('Events processing failed');
      });

      // Act & Assert
      await expect(
        controller.handleOzonetelEventsSubscription(
          mockCode,
          mockCallEventsData,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error processing Ozonetel events subscription with error',
        ),
      );
    });

    it('should handle various parameter formats', async () => {
      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Test empty code
      const emptyCode = '';
      const resultEmptyCode = await controller.handleOzonetelEventsSubscription(
        emptyCode,
        mockCallEventsData,
      );

      expect(resultEmptyCode).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        mockCallEventsData,
        emptyCode,
      );

      // Reset mock
      ozonetelService.handleOzonetelCallEvents.mockClear();
      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Test undefined code
      const undefinedCode = undefined as any;
      const resultUndefinedCode =
        await controller.handleOzonetelEventsSubscription(
          undefinedCode,
          mockCallEventsData,
        );

      expect(resultUndefinedCode).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        mockCallEventsData,
        undefinedCode,
      );

      // Reset mock
      ozonetelService.handleOzonetelCallEvents.mockClear();
      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Test empty body
      const emptyBody = {};
      const resultEmptyBody = await controller.handleOzonetelEventsSubscription(
        mockCode,
        emptyBody,
      );

      expect(resultEmptyBody).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        emptyBody,
        mockCode,
      );

      // Reset mock
      ozonetelService.handleOzonetelCallEvents.mockClear();
      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Test null body
      const nullBody = null as any;
      const resultNullBody = await controller.handleOzonetelEventsSubscription(
        mockCode,
        nullBody,
      );

      expect(resultNullBody).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        nullBody,
        mockCode,
      );
    });

    it('should handle complex events data', async () => {
      // Arrange
      const complexEventsData: OzonetelCallEventsDto = {
        eventType: 'Agent',
        eventTime: '2024-01-01 10:05:00',
        username: 'complex-user',
        data: {
          action: 'Disconnect',
          call_type: 'Outbound',
          ucid: 'complex-ucid-123',
          monitor_ucid: 'complex-monitor-456',
          agent_id: 'complex-agent-789',
          skill: 'Sales',
          caller_id: '+5555555555',
          did: 'complex-did-123',
          agent_number: '+6666666666',
          event_time: '2024-01-01 10:05:00',
        },
      };

      ozonetelService.handleOzonetelCallEvents.mockResolvedValue(undefined);

      // Act
      const result = await controller.handleOzonetelEventsSubscription(
        mockCode,
        complexEventsData,
      );

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Events subscription processed successfully',
      });
      expect(ozonetelService.handleOzonetelCallEvents).toHaveBeenCalledWith(
        complexEventsData,
        mockCode,
      );
    });

    it('should handle service throwing different error types', async () => {
      // Arrange
      ozonetelService.handleOzonetelCallEvents.mockImplementation(() => {
        throw new Error(
          'Custom service error with special characters: !@#$%^&*()',
        );
      });

      // Act & Assert
      await expect(
        controller.handleOzonetelEventsSubscription(
          mockCode,
          mockCallEventsData,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error processing Ozonetel events subscription with error',
        ),
      );
    });
  });
});
