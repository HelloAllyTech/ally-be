import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LogsService } from '../logs.service';
import { CloudWatchLogsService } from '../../aws/service/cloudwatch-logs.service';
import { AppConfigService } from '../../config/config.service';

describe('LogsService', () => {
  let service: LogsService;
  let mockCloudWatchLogsService: jest.Mocked<CloudWatchLogsService>;
  let mockConfig: {
    awsLogs: { logGroups: Record<string, string | undefined> };
  };

  beforeEach(async () => {
    mockCloudWatchLogsService = {
      filterLogEvents: jest.fn(),
      listLogStreams: jest.fn(),
    } as any;

    mockConfig = {
      awsLogs: {
        logGroups: {
          'ally-be': '/ecs/ally-prd-svc-core',
          'ally-ai': undefined,
          'ally-ai-learn': '/ecs/ally-prd-svc-learn-core',
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        { provide: CloudWatchLogsService, useValue: mockCloudWatchLogsService },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<LogsService>(LogsService);
  });

  describe('getLogEvents', () => {
    it('resolves the log group and passes a level+search filter pattern through', async () => {
      mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
        events: [
          {
            timestamp: 1000,
            message: 'ERROR boom',
            logStreamName: 'stream-a',
            eventId: 'evt-1',
          },
        ],
        nextToken: undefined,
      });

      const result = await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        level: 'ERROR',
        search: 'boom',
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          logGroupName: '/ecs/ally-prd-svc-core',
          filterPattern: '"ERROR" "boom"',
        }),
      );
      expect(result.events).toEqual([
        {
          timestamp: 1000,
          message: 'ERROR boom',
          logStreamName: 'stream-a',
          eventId: 'evt-1',
        },
      ]);
    });

    it('throws a BadRequestException when the service has no configured log group', async () => {
      await expect(
        service.getLogEvents({
          service: 'ally-ai',
          startTime: 1000,
          endTime: 2000,
          limit: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listLogStreams', () => {
    it('resolves the log group and maps streams', async () => {
      mockCloudWatchLogsService.listLogStreams.mockResolvedValue({
        streams: [{ logStreamName: 'stream-a', lastEventTimestamp: 5000 }],
        nextToken: undefined,
      });

      const result = await service.listLogStreams({ service: 'ally-ai-learn' });

      expect(mockCloudWatchLogsService.listLogStreams).toHaveBeenCalledWith(
        expect.objectContaining({
          logGroupName: '/ecs/ally-prd-svc-learn-core',
        }),
      );
      expect(result.streams).toEqual([
        { name: 'stream-a', lastEventTime: 5000 },
      ]);
    });
  });
});
