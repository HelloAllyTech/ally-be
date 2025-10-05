import { Test, TestingModule } from '@nestjs/testing';
import { Msg91Service } from '../msg91.service';
import { AppConfigService } from 'src/config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock LoggerService
const mockLoggerInstance = {
  info: jest.fn(),
};

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('Msg91Service', () => {
  let service: Msg91Service;
  let mockConfig: any;
  let mockEventEmitter: any;
  const mockConfigData = {
    sms: {
      msg91: {
        apiKey: 'test-api-key',
        templateId: 'test-template-id',
        apiUrl: 'https://api.msg91.com/test',
      },
    },
  };

  beforeEach(async () => {
    mockConfig = {
      sms: mockConfigData.sms,
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Msg91Service,
        { provide: AppConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<Msg91Service>(Msg91Service);
  });

  describe('sendOTP', () => {
    it('should log info and emit event', async () => {
      const to = '+1234567890';
      const otp = '123456';

      await service.sendOTP(to, otp);

      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        `Sending OTP to ${to}`,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('exception', {
        statusCode: 200,
        timestamp: expect.any(String),
        path: '/api/v1/sms/otp',
        message: `OTP sent to ${to} - ${otp}`,
        type: 'SMS OTP',
        channel: 'C08T402E3K5',
      });
    });
  });

  describe('sendSMS', () => {
    it('should log info message', async () => {
      const to = '+1234567890';
      const body = 'Test SMS message';

      await service.sendSMS(to, body);

      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        `Sending SMS to ${to} with body ${body}`,
      );
    });
  });

  describe('makeRequest', () => {
    it('should make axios POST request and return response data', async () => {
      const url = 'https://api.test.com';
      const data = { test: 'data' };
      const mockResponse = { data: { success: true } };
      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await service.makeRequest(url, data);

      expect(mockedAxios.post).toHaveBeenCalledWith(url, data, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result).toEqual(mockResponse.data);
    });
  });
});
