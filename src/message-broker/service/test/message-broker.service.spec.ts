import { Test, TestingModule } from '@nestjs/testing';
import { MessageBrokerService } from '../message-broker.service';
import { MessageBroker } from '../../interface/message-broker.interface';

describe('MessageBrokerService', () => {
  let service: MessageBrokerService;
  let mockBroker: jest.Mocked<MessageBroker>;

  beforeEach(async () => {
    // Create mock MessageBroker
    const mockMessageBroker = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageBrokerService,
        {
          provide: 'MessageBroker',
          useValue: mockMessageBroker,
        },
      ],
    }).compile();

    service = module.get<MessageBrokerService>(MessageBrokerService);
    mockBroker = module.get('MessageBroker');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should inject MessageBroker dependency', () => {
      expect(service).toBeDefined();
      expect(mockBroker).toBeDefined();
    });
  });

  describe('publish', () => {
    it('should delegate publish call to injected broker', async () => {
      const channel = 'test-channel';
      const message = { id: 1, data: 'test data' };

      mockBroker.publish.mockResolvedValue(undefined);

      await service.publish(channel, message);

      expect(mockBroker.publish).toHaveBeenCalledWith(channel, message);
      expect(mockBroker.publish).toHaveBeenCalledTimes(1);
    });

    it('should handle different message types', async () => {
      const channel = 'test-channel';
      const stringMessage = 'string message';
      const numberMessage = 123;
      const objectMessage = { key: 'value' };
      const nullMessage = null;

      mockBroker.publish.mockResolvedValue(undefined);

      await service.publish(channel, stringMessage);
      expect(mockBroker.publish).toHaveBeenCalledWith(channel, stringMessage);

      await service.publish(channel, numberMessage);
      expect(mockBroker.publish).toHaveBeenCalledWith(channel, numberMessage);

      await service.publish(channel, objectMessage);
      expect(mockBroker.publish).toHaveBeenCalledWith(channel, objectMessage);

      await service.publish(channel, nullMessage);
      expect(mockBroker.publish).toHaveBeenCalledWith(channel, nullMessage);
    });

    it('should propagate broker publish errors', async () => {
      const channel = 'test-channel';
      const message = { test: 'data' };
      const error = new Error('Broker publish failed');

      mockBroker.publish.mockRejectedValue(error);

      await expect(service.publish(channel, message)).rejects.toThrow(
        'Broker publish failed',
      );
    });

    it('should handle empty channel name', async () => {
      const channel = '';
      const message = { test: 'data' };

      mockBroker.publish.mockResolvedValue(undefined);

      await service.publish(channel, message);

      expect(mockBroker.publish).toHaveBeenCalledWith(channel, message);
    });
  });

  describe('subscribe', () => {
    it('should delegate subscribe call to injected broker', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();

      mockBroker.subscribe.mockResolvedValue(undefined);

      await service.subscribe(channel, callback);

      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel, callback);
      expect(mockBroker.subscribe).toHaveBeenCalledTimes(1);
    });

    it('should handle different callback functions', async () => {
      const channel = 'test-channel';
      const callback1 = jest.fn();
      const callback2 = (message: any) => console.log(message);
      const callback3 = async () => {
        // async callback
        return Promise.resolve();
      };

      mockBroker.subscribe.mockResolvedValue(undefined);

      await service.subscribe(channel, callback1);
      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel, callback1);

      await service.subscribe(channel, callback2);
      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel, callback2);

      await service.subscribe(channel, callback3);
      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel, callback3);
    });

    it('should propagate broker subscribe errors', async () => {
      const channel = 'test-channel';
      const callback = jest.fn();
      const error = new Error('Broker subscribe failed');

      mockBroker.subscribe.mockRejectedValue(error);

      await expect(service.subscribe(channel, callback)).rejects.toThrow(
        'Broker subscribe failed',
      );
    });

    it('should handle empty channel name', async () => {
      const channel = '';
      const callback = jest.fn();

      mockBroker.subscribe.mockResolvedValue(undefined);

      await service.subscribe(channel, callback);

      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel, callback);
    });

    it('should handle multiple subscriptions with same callback', async () => {
      const channel1 = 'channel1';
      const channel2 = 'channel2';
      const callback = jest.fn();

      mockBroker.subscribe.mockResolvedValue(undefined);

      await service.subscribe(channel1, callback);
      await service.subscribe(channel2, callback);

      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel1, callback);
      expect(mockBroker.subscribe).toHaveBeenCalledWith(channel2, callback);
      expect(mockBroker.subscribe).toHaveBeenCalledTimes(2);
    });
  });
});
