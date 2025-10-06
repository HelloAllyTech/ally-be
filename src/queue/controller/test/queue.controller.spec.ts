import { Test, TestingModule } from '@nestjs/testing';
import { QueueController } from '../queue.controller';
import { QueueService } from '../../service/queue.service';
import { QueueStatus } from 'src/common/constants/chat.constants';

describe('QueueController', () => {
  let controller: QueueController;
  let mockQueueService: any;

  const mockQueueStats = [
    {
      entryId: 1,
      clientId: 123,
      chatId: 456,
      priority: 5,
      waitStartTime: new Date('2024-01-01T10:00:00Z'),
      status: QueueStatus.WAITING,
    },
    {
      entryId: 2,
      clientId: 124,
      chatId: 457,
      priority: 3,
      waitStartTime: new Date('2024-01-01T11:00:00Z'),
      status: QueueStatus.MATCHED,
    },
  ];

  beforeEach(async () => {
    mockQueueService = {
      getStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [{ provide: QueueService, useValue: mockQueueService }],
    }).compile();

    controller = module.get<QueueController>(QueueController);
  });

  describe('getStats', () => {
    it('should return queue statistics', async () => {
      mockQueueService.getStats.mockResolvedValue(mockQueueStats);

      const result = await controller.getStats();

      expect(mockQueueService.getStats).toHaveBeenCalled();
      expect(result).toEqual(mockQueueStats);
    });
  });
});
