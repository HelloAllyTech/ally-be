import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailSendFailedException, SESService } from '../ses.service';
import { AppConfigService } from '../../../config/config.service';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EMAIL_SEND_FAILED_EVENT } from '../../../notification/type/email-send-failed.event';

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

jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('SESService', () => {
  let service: SESService;
  let mockConfig: any;
  let mockSesClient: any;
  let mockEventEmitter: { emit: jest.Mock };

  const mockConfigData = {
    email: {
      ses: {
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
    },
  };

  beforeEach(async () => {
    mockSesClient = {
      send: jest.fn(),
    };

    mockConfig = {
      email: mockConfigData.email,
    };

    mockEventEmitter = { emit: jest.fn() };

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

  afterEach(() => {
    jest.clearAllMocks();
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
    it('should send email successfully with single recipient', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
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
        'Email sent to recipient@example.com',
      );
      expect(result).toBe(true);
    });

    it('should send email successfully with multiple recipients', async () => {
      const params = {
        from: 'sender@example.com',
        to: ['recipient1@example.com', 'recipient2@example.com'],
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient1@example.com', 'recipient2@example.com'],
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
        'Email sent to recipient1@example.com, recipient2@example.com',
      );
      expect(result).toBe(true);
    });

    it('should send email with HTML body when isHtml is true', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: '<p>Test HTML Body</p>',
        isHtml: true,
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
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

    it('should send email with text body when isHtml is false', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Text Body',
        isHtml: false,
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test Subject',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test Text Body',
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(result).toBe(true);
    });

    it('should default to text body when isHtml is not specified', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
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
      expect(result).toBe(true);
    });

    it('should handle missing from parameter', async () => {
      const params = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: undefined,
        Destination: {
          ToAddresses: ['recipient@example.com'],
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
      expect(result).toBe(true);
    });

    it('should throw EmailSendFailedException and alert on failure, rather than silently returning false', async () => {
      // Was: swallow to `false`, no throw, no signal — the OTP path could tell
      // a user "code sent" while SES never received it. Fixed to throw and to
      // emit EMAIL_SEND_FAILED_EVENT so NotificationEventConsumer can page.
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
        purpose: 'login OTP',
      };
      const error = new Error('SES Error');
      mockSesClient.send.mockRejectedValue(error);

      await expect(service.sendEmail(params)).rejects.toBeInstanceOf(
        EmailSendFailedException,
      );

      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send email via SES'),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EMAIL_SEND_FAILED_EVENT,
        expect.objectContaining({
          purpose: 'login OTP',
          subject: 'Test Subject',
          recipientCount: 1,
          reason: 'SES Error',
          recipientDomains: ['example.com'],
        }),
      );
    });

    it('should not alert when alertOnFailure is false, but still throw', async () => {
      // The bulk-sender escape hatch: a 200-recipient batch alerts once itself
      // rather than paging once per recipient.
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
        alertOnFailure: false,
      };
      mockSesClient.send.mockRejectedValue(new Error('SES Error'));

      await expect(service.sendEmail(params)).rejects.toBeInstanceOf(
        EmailSendFailedException,
      );
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should handle a non-Error AWS SDK rejection and still throw/alert', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      const awsError = {
        name: 'MessageRejected',
        message: 'Email address not verified',
        $metadata: { httpStatusCode: 400 },
      };
      mockSesClient.send.mockRejectedValue(awsError);

      await expect(service.sendEmail(params)).rejects.toBeInstanceOf(
        EmailSendFailedException,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EMAIL_SEND_FAILED_EVENT,
        expect.objectContaining({ reason: 'unknown error' }),
      );
    });

    it('should handle empty recipient array', async () => {
      const params = {
        from: 'sender@example.com',
        to: [],
        subject: 'Test Subject',
        body: 'Test Body',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: [],
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
      expect(mockLoggerInstance.info).toHaveBeenCalledWith('Email sent to ');
      expect(result).toBe(true);
    });

    it('should handle special characters in email content', async () => {
      const params = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject with émojis 🚀',
        body: 'Test Body with special chars: àáâãäåæçèéêë',
      };
      mockSesClient.send.mockResolvedValue({});

      const result = await service.sendEmail(params);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        Source: 'sender@example.com',
        Destination: {
          ToAddresses: ['recipient@example.com'],
        },
        Message: {
          Subject: {
            Data: 'Test Subject with émojis 🚀',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'Test Body with special chars: àáâãäåæçèéêë',
              Charset: 'UTF-8',
            },
          },
        },
      });
      expect(result).toBe(true);
    });
  });
});
