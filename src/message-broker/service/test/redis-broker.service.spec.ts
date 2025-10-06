import { Test, TestingModule } from '@nestjs/testing';
import { RedisBrokerService } from '../redis-broker.service';
import { RedisService } from '../../../redis/service/redis.service';
import Redis from 'ioredis';

describe('RedisBrokerService', () => {
  let service: RedisBrokerService;
  let redisService: jest.Mocked<RedisService>;
  let mockPubClient: jest.Mocked<Redis>;
  let mockSubClient: jest.Mocked<Redis>;

  beforeEach(async () => {
    // Create mock Redis clients
    mockPubClient = {
      publish: jest.fn(),
    } as any;

    mockSubClient = {
      subscribe: jest.fn(),
      on: jest.fn().mockReturnThis(),
    } as any;

    // Create mock RedisService
    const mockRedisService = {
      createClient: jest
        .fn()
        .mockReturnValueOnce(mockPubClient)
        .mockReturnValueOnce(mockSubClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisBrokerService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<RedisBrokerService>(RedisBrokerService);
    redisService = module.get(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create pub and sub clients using RedisService', () => {
      expect(redisService.createClient).toHaveBeenCalledWith('publisher');
      expect(redisService.createClient).toHaveBeenCalledWith('subscriber');
    });
  });

  describe('publish', () => {
    it('should publish message to Redis channel with JSON stringification', async () => {
      const channel = 'test-channel';
      const message = { id: 1, data: 'test data' };
      const expectedJsonMessage = JSON.stringify(message);

      mockPubClient.publish.mockResolvedValue(1);

      await service.publish(channel, message);

      expect(mockPubClient.publish).toHaveBeenCalledWith(
        channel,
        expectedJsonMessage,
      );
    });

    it('should handle primitive message types', async () => {
      const channel = 'test-channel';
      const message = 'simple string message';

      mockPubClient.publish.mockResolvedValue(1);

      await service.publish(channel, message);

      expect(mockPubClient.publish).toHaveBeenCalledWith(
        channel,
        JSON.stringify(message),
      );
    });

    it('should handle null and undefined messages', async () => {
      const channel = 'test-channel';

      mockPubClient.publish.mockResolvedValue(1);

      await service.publish(channel, null);
      expect(mockPubClient.publish).toHaveBeenCalledWith(
        channel,
        JSON.stringify(null),
      );

      await service.publish(channel, undefined);
      expect(mockPubClient.publish).toHaveBeenCalledWith(
        channel,
        JSON.stringify(undefined),
      );
    });

    it('should propagate Redis publish errors', async () => {
      const channel = 'test-channel';
      const message = { test: 'data' };
      const error = new Error('Redis connection failed');

      mockPubClient.publish.mockRejectedValue(error);

      await expect(service.publish(channel, message)).rejects.toThrow(
        'Redis connection failed',
      );
    });
  });

  describe('subscribe', () => {
    it('should subscribe to channel and setup message handler', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();

      mockSubClient.subscribe.mockResolvedValue('OK');

      await service.subscribe(channel, callback);

      expect(mockSubClient.subscribe).toHaveBeenCalledWith(channel);
      expect(mockSubClient.on).toHaveBeenCalledWith(
        'message',
        expect.any(Function),
      );
    });

    it('should call callback with parsed message when message arrives on correct channel', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();
      const message = { id: 1, data: 'test data' };
      const jsonMessage = JSON.stringify(message);

      mockSubClient.subscribe.mockResolvedValue('OK');
      let messageHandler: (receivedChannel: string, message: string) => void;

      mockSubClient.on.mockImplementation((event, handler) => {
        if (event === 'message') {
          messageHandler = handler;
        }
        return mockSubClient;
      });

      await service.subscribe(channel, callback);

      // Simulate message arrival
      messageHandler!(channel, jsonMessage);

      expect(callback).toHaveBeenCalledWith(message);
    });

    it('should not call callback when message arrives on different channel', async () => {
      const channel = 'test-channel';
      const differentChannel = 'different-channel';
      const callback = jest.fn();
      const message = { id: 1, data: 'test data' };
      const jsonMessage = JSON.stringify(message);

      mockSubClient.subscribe.mockResolvedValue('OK');
      let messageHandler: (receivedChannel: string, message: string) => void;

      mockSubClient.on.mockImplementation((event, handler) => {
        if (event === 'message') {
          messageHandler = handler;
        }
        return mockSubClient;
      });

      await service.subscribe(channel, callback);

      // Simulate message arrival on different channel
      messageHandler!(differentChannel, jsonMessage);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle JSON parse errors gracefully', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();
      const invalidJsonMessage = 'invalid json {';

      mockSubClient.subscribe.mockResolvedValue('OK');
      let messageHandler: (receivedChannel: string, message: string) => void;

      mockSubClient.on.mockImplementation((event, handler) => {
        if (event === 'message') {
          messageHandler = handler;
        }
        return mockSubClient;
      });

      await service.subscribe(channel, callback);

      // Simulate message arrival with invalid JSON
      expect(() => {
        messageHandler!(channel, invalidJsonMessage);
      }).toThrow();
    });

    it('should propagate Redis subscribe errors', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();
      const error = new Error('Redis connection failed');

      mockSubClient.subscribe.mockRejectedValue(error);

      await expect(service.subscribe(channel, callback)).rejects.toThrow(
        'Redis connection failed',
      );
    });

    it('should handle multiple subscriptions to same channel', async () => {
      const channel = 'test-channel';
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      mockSubClient.subscribe.mockResolvedValue('OK');

      await service.subscribe(channel, callback1);
      await service.subscribe(channel, callback2);

      expect(mockSubClient.subscribe).toHaveBeenCalledTimes(2);
      expect(mockSubClient.on).toHaveBeenCalledTimes(2);
    });
  });
});
