import { Test, TestingModule } from '@nestjs/testing';
import { SESService } from '../ses.service';
import { AppConfigService } from 'src/config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Mock AWS SDK
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  SendEmailCommand: jest.fn(),
}));

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

describe('SESService', () => {
  let service: SESService;
  let mockConfig: any;
  let mockEventEmitter: any;
  let mockSesClient: any;

  const mockConfigData = {
    email: {
      ses: {
        region: 'us-east-1',
        sourceEmail: 'test@example.com',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
    },
    isDevelopment: false,
    otp: {
      ttl: 300, // 5 minutes in seconds
    },
  };

  beforeEach(async () => {
    mockSesClient = {
      send: jest.fn(),
    };

    mockConfig = {
      email: mockConfigData.email,
      isDevelopment: mockConfigData.isDevelopment,
      otp: mockConfigData.otp,
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SESService,
        { provide: AppConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SESService>(SESService);
    // Get the mocked SESClient instance
    mockSesClient = (service as any).sesClient;
  });

  describe('constructor', () => {
    it('should initialize with config values', () => {
      expect(service).toBeDefined();
      expect(SESClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      });
    });
  });

  describe('sendEmail', () => {
    it('should send email successfully with recipient', async () => {
      const params = {
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'test@example.com',
        Destination: {
          ToAddresses: ['test@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test Subject',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test Body',
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(mockSesClient.send).toHaveBeenCalled();
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        'Email sent to test@example.com',
      );
      expect(result).toBe(true);
    });

    it('should send email successfully with array recipients', async () => {
      const params = {
        to: ['test1@example.com', 'test2@example.com'],
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'test@example.com',
        Destination: {
          ToAddresses: ['test1@example.com', 'test2@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test Subject',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test Body',
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        'Email sent to test1@example.com, test2@example.com',
      );
      expect(result).toBe(true);
    });

    it('should send email with HTML body when isHtml is true', async () => {
      const params = {
        to: 'test@example.com',
        subject: 'Test Subject',
        body: '<p>Test HTML Body</p>',
        isHtml: true,
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'test@example.com',
        Destination: {
          ToAddresses: ['test@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test Subject',
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: '<p>Test HTML Body</p>',
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(result).toBe(true);
    });

    it('should handle error and return false', async () => {
      const params = {
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      const error = new Error('SES Error');
      mockSesClient.send.mockRejectedValue(error);

      const result = await service.sendEmail(params);

      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        `Failed to send email via SES with error ${JSON.stringify(error)}`,
      );
      expect(result).toBe(false);
    });
  });

  describe('sendEmailOTP', () => {
    it('should send OTP email in production mode', async () => {
      const params = { to: 'test@example.com', otp: '123456' };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmailOTP(params);

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'test@example.com',
        Destination: {
          ToAddresses: ['test@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Your Ally Verification Code',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: `Your Ally Verification Code is:
123456

⏱️ This security code is valid for the next 5 minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`,
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(result).toBe(true);
    });

    it('should emit event in development mode', async () => {
      mockConfig.isDevelopment = true;
      const params = { to: 'test@example.com', otp: '123456' };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmailOTP(params);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('exception', {
        statusCode: 200,
        timestamp: expect.any(String),
        path: '/api/v1/sms/otp',
        message: 'OTP sent to test@example.com - 123456',
        type: 'EMAIL OTP',
        channel: 'C08T402E3K5',
      });
      expect(result).toBe(true);
    });
  });
});
