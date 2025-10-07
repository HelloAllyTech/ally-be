import { Test, TestingModule } from '@nestjs/testing';
import { SlackService } from '../slack.service';
import { AppConfigService } from 'src/config/config.service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock LoggerService
const mockLoggerInstance = {
  error: jest.fn(),
};

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('SlackService', () => {
  let service: SlackService;
  let mockConfig: any;

  const mockConfigData = {
    slack: {
      botToken: 'xoxb-test-bot-token',
      channel: 'C08T402E3K5',
    },
  };

  beforeEach(async () => {
    mockConfig = {
      slack: mockConfigData.slack,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackService,
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<SlackService>(SlackService);
  });

  describe('sendMessage', () => {
    it('should send message successfully with default channel', async () => {
      const message = 'Test message';
      mockedAxios.post.mockResolvedValue({});

      await service.sendMessage(message);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        {
          channel: 'C08T402E3K5',
          text: 'Test message',
        },
        {
          headers: {
            Authorization: 'Bearer xoxb-test-bot-token',
          },
        },
      );
    });

    it('should send message successfully with provided channel', async () => {
      const message = 'Test message';
      const customChannel = 'C1234567890';
      mockedAxios.post.mockResolvedValue({});

      await service.sendMessage(message, customChannel);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        {
          channel: customChannel,
          text: 'Test message',
        },
        {
          headers: {
            Authorization: 'Bearer xoxb-test-bot-token',
          },
        },
      );
    });

    it('should handle error and log it', async () => {
      const message = 'Test message';
      const error = new Error('Slack API Error');
      mockedAxios.post.mockRejectedValue(error);

      await service.sendMessage(message);

      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Slack sendMessage error',
        error,
      );
    });
  });
});
