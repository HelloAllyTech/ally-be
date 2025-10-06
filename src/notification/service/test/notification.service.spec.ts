import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from '../notification.service';
import { SlackService } from '../slack.service';
import { SMSInterface } from '../../interface/sms.interface';
import { EmailInterface } from '../../interface/email.interface';
import { NotificationErrorType } from '../../type/notification.error.type';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockSlackService: any;
  let mockSmsService: any;
  let mockEmailService: any;

  const mockNotificationError: NotificationErrorType = {
    statusCode: 500,
    timestamp: '2024-01-01T10:00:00Z',
    path: '/api/test',
    message: 'Test error message',
    type: 'ERROR',
    channel: 'test-channel',
  };

  const mockIgnoredError: NotificationErrorType = {
    statusCode: 401,
    timestamp: '2024-01-01T10:00:00Z',
    path: '/api/auth',
    message: 'Unauthorized',
    type: 'AUTH_ERROR',
    channel: 'auth-channel',
  };

  beforeEach(async () => {
    mockSlackService = {
      sendMessage: jest.fn(),
    };

    mockSmsService = {
      sendSMS: jest.fn(),
      sendOTP: jest.fn(),
    };

    mockEmailService = {
      sendEmailOTP: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: SlackService, useValue: mockSlackService },
        { provide: SMSInterface, useValue: mockSmsService },
        { provide: EmailInterface, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('handleException', () => {
    it('should ignore status code 401 and return early', () => {
      service.handleException(mockIgnoredError);

      expect(mockSlackService.sendMessage).not.toHaveBeenCalled();
    });

    it('should send Slack message for non-ignored status codes', () => {
      service.handleException(mockNotificationError);

      const expectedMessage = `*${mockNotificationError.type}* - ${mockNotificationError.message} - ${mockNotificationError.statusCode} - ${mockNotificationError.path} - ${mockNotificationError.timestamp}`;
      expect(mockSlackService.sendMessage).toHaveBeenCalledWith(
        expectedMessage,
        mockNotificationError.channel,
      );
    });
  });

  describe('sendSMS', () => {
    it('should send SMS message', async () => {
      const to = '+1234567890';
      const body = 'Test SMS message';

      await service.sendSMS(to, body);

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(to, body);
    });
  });

  describe('sendOTP', () => {
    it('should send OTP via SMS', async () => {
      const to = '+1234567890';
      const otp = '123456';

      await service.sendOTP(to, otp);

      expect(mockSmsService.sendOTP).toHaveBeenCalledWith(to, otp);
    });
  });

  describe('sendEmailOTP', () => {
    it('should send OTP via email', async () => {
      const to = 'test@example.com';
      const otp = '123456';

      await service.sendEmailOTP(to, otp);

      expect(mockEmailService.sendEmailOTP).toHaveBeenCalledWith({ to, otp });
    });
  });
});
