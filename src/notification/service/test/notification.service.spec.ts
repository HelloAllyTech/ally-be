import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from '../notification.service';
import { SlackService } from '../slack.service';
import { EmailService } from '../email.service';
import { NotificationErrorType } from '../../type/notification.error.type';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockSlackService: any;
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

    mockEmailService = {
      sendEmailOTP: jest.fn(),
      sendSummaryNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: SlackService, useValue: mockSlackService },
        { provide: EmailService, useValue: mockEmailService },
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

  describe('sendEmailOTP', () => {
    it('should send OTP via email', async () => {
      const to = 'test@example.com';
      const otp = '123456';

      await service.sendEmailOTP(to, otp);

      expect(mockEmailService.sendEmailOTP).toHaveBeenCalledWith({ to, otp });
    });
  });

  describe('sendEmailSummaryNotification', () => {
    it('should send summary email notification', async () => {
      const params = {
        to: 'counselor@example.com',
        chatId: 123,
        summaryName: 'summary-456',
      };

      await service.sendEmailSummaryNotification(params);

      expect(mockEmailService.sendSummaryNotification).toHaveBeenCalledWith(
        params,
      );
    });

    it('should send summary email notification without summaryName', async () => {
      const params = {
        to: 'counselor@example.com',
        chatId: 123,
      };

      await service.sendEmailSummaryNotification(params);

      expect(mockEmailService.sendSummaryNotification).toHaveBeenCalledWith(
        params,
      );
    });
  });
});
