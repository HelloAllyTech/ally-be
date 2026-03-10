import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEventConsumer } from '../notification.event.consumer';
import { NotificationService } from '../../service/notification.service';
import { NotificationErrorType } from '../../type/notification.error.type';

describe('NotificationEventConsumer', () => {
  let consumer: NotificationEventConsumer;
  let mockNotificationService: any;

  const mockNotificationError: NotificationErrorType = {
    statusCode: 500,
    timestamp: '2024-01-01T10:00:00Z',
    path: '/api/test',
    message: 'Test error message',
    type: 'ERROR',
    channel: 'test-channel',
  };

  const mockOtpPayload = {
    email: 'test@example.com',
    otp: '123456',
  };

  beforeEach(async () => {
    mockNotificationService = {
      handleException: jest.fn(),
      sendEmailOTP: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationEventConsumer,
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    consumer = module.get<NotificationEventConsumer>(NotificationEventConsumer);
  });

  describe('handleException', () => {
    it('should call notificationService.handleException with payload', () => {
      consumer.handleException(mockNotificationError);

      expect(mockNotificationService.handleException).toHaveBeenCalledWith(
        mockNotificationError,
      );
    });
  });

  describe('handleOtpGenerated', () => {
    it('should call notificationService.sendEmailOTP with email and otp', () => {
      consumer.handleOtpGenerated(mockOtpPayload);

      expect(mockNotificationService.sendEmailOTP).toHaveBeenCalledWith(
        mockOtpPayload.email,
        mockOtpPayload.otp,
        undefined,
        undefined,
      );
    });
  });
});
