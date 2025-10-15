import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from '../email.service';
import { AppConfigService } from 'src/config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SESService } from 'src/aws/service/ses.service';

// Mock SESService
const mockSESService = {
  sendEmail: jest.fn(),
};

// Mock LoggerService
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
};

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('EmailService', () => {
  let service: EmailService;
  let mockConfig: any;
  let mockEventEmitter: any;

  const mockConfigData = {
    email: {
      sourceEmail: 'test@example.com',
      ses: {
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
    },
    app: {
      baseUrl: 'https://test.example.com',
    },
    isDevelopment: false,
    otp: {
      ttl: 300, // 5 minutes in seconds
    },
  };

  beforeEach(async () => {
    mockConfig = {
      email: mockConfigData.email,
      app: mockConfigData.app,
      isDevelopment: mockConfigData.isDevelopment,
      otp: mockConfigData.otp,
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: AppConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SESService, useValue: mockSESService },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config values', () => {
      expect(service).toBeDefined();
    });
  });

  describe('sendEmailOTP', () => {
    it('should send OTP email in production mode', async () => {
      const params = { to: 'test@example.com', otp: '123456' };
      mockSESService.sendEmail.mockResolvedValue(true);

      const result = await service.sendEmailOTP(params);

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(mockSESService.sendEmail).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: 'test@example.com',
        subject: 'Your Ally Verification Code',
        body: `Your Ally Verification Code is:
123456

⏱️ This security code is valid for the next 5 minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`,
        isHtml: false,
      });
      expect(result).toBe(true);
    });

    it('should emit event in development mode', async () => {
      mockConfig.isDevelopment = true;
      const params = { to: 'test@example.com', otp: '123456' };
      mockSESService.sendEmail.mockResolvedValue(true);

      const result = await service.sendEmailOTP(params);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('exception', {
        statusCode: 200,
        timestamp: expect.any(String),
        path: '/api/v1/sms/otp',
        message: 'OTP sent to test@example.com - 123456',
        type: 'EMAIL OTP',
        channel: 'C08T402E3K5',
      });
      expect(mockSESService.sendEmail).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: 'test@example.com',
        subject: 'Your Ally Verification Code',
        body: `Your Ally Verification Code is:
123456

⏱️ This security code is valid for the next 5 minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`,
        isHtml: false,
      });
      expect(result).toBe(true);
    });
  });

  describe('sendSummaryNotification', () => {
    it('should send summary notification email', async () => {
      const params = {
        to: 'counselor@example.com',
        chatId: 123,
        summaryName: 'session-456',
      };
      mockSESService.sendEmail.mockResolvedValue(true);

      const result = await service.sendSummaryNotification(params);

      expect(mockSESService.sendEmail).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: 'counselor@example.com',
        subject: 'Your Ally Call Summary is Ready',
        body: `Hello,

Your call summary for session ID: session-456 has been generated and is now available for review.

You can view the complete summary by clicking the link below:
https://test.example.com/summary/123?source=deeplink

Best regards,
The Ally Team`,
        isHtml: false,
      });
      expect(result).toBe(true);
    });

    it('should send summary notification email without summaryName', async () => {
      const params = {
        to: 'counselor@example.com',
        chatId: 123,
      };
      mockSESService.sendEmail.mockResolvedValue(true);

      const result = await service.sendSummaryNotification(params);

      expect(mockSESService.sendEmail).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: 'counselor@example.com',
        subject: 'Your Ally Call Summary is Ready',
        body: `Hello,

Your call summary  has been generated and is now available for review.

You can view the complete summary by clicking the link below:
https://test.example.com/summary/123?source=deeplink

Best regards,
The Ally Team`,
        isHtml: false,
      });
      expect(result).toBe(true);
    });

    it('should handle email sending failure', async () => {
      const params = {
        to: 'counselor@example.com',
        chatId: 123,
        summaryName: 'session-456',
      };
      mockSESService.sendEmail.mockResolvedValue(false);

      const result = await service.sendSummaryNotification(params);

      expect(result).toBe(false);
    });
  });
});
