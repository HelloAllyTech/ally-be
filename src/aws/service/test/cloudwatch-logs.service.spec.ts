import { Test, TestingModule } from '@nestjs/testing';
import { CloudWatchLogsService } from '../cloudwatch-logs.service';
import { AppConfigService } from '../../../config/config.service';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

jest.mock('@aws-sdk/client-cloudwatch-logs');

describe('CloudWatchLogsService', () => {
  let service: CloudWatchLogsService;
  let mockClient: { send: jest.Mock };

  const mockAwsConfig = {
    region: 'us-east-1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    sessionToken: undefined,
    endpointUrl: undefined,
  };

  beforeEach(async () => {
    mockClient = { send: jest.fn() };

    (
      CloudWatchLogsClient as jest.MockedClass<typeof CloudWatchLogsClient>
    ).mockImplementation(() => mockClient as any);

    const mockConfig = { aws: mockAwsConfig } as unknown as AppConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudWatchLogsService,
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<CloudWatchLogsService>(CloudWatchLogsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('filterLogEvents', () => {
    it('sends a FilterLogEventsCommand and maps the response', async () => {
      mockClient.send.mockResolvedValue({
        events: [
          {
            timestamp: 1000,
            message: 'ERROR something broke',
            logStreamName: 'stream-a',
            eventId: 'evt-1',
          },
        ],
        nextToken: 'token-2',
      });

      const result = await service.filterLogEvents({
        logGroupName: '/ecs/ally-prd-svc-core',
        startTime: 1000,
        endTime: 2000,
        filterPattern: '"ERROR"',
      });

      expect(mockClient.send).toHaveBeenCalledWith(
        expect.any(FilterLogEventsCommand),
      );
      expect(result).toEqual({
        events: [
          {
            timestamp: 1000,
            message: 'ERROR something broke',
            logStreamName: 'stream-a',
            eventId: 'evt-1',
          },
        ],
        nextToken: 'token-2',
      });
    });

    it('wraps AWS SDK failures in a descriptive error', async () => {
      mockClient.send.mockRejectedValue(new Error('rate limited'));

      await expect(
        service.filterLogEvents({
          logGroupName: '/ecs/ally-prd-svc-core',
          startTime: 1000,
          endTime: 2000,
        }),
      ).rejects.toThrow('Failed to filter log events: rate limited');
    });
  });

  describe('listLogStreams', () => {
    it('sends a DescribeLogStreamsCommand ordered by LastEventTime', async () => {
      mockClient.send.mockResolvedValue({
        logStreams: [{ logStreamName: 'stream-a', lastEventTimestamp: 5000 }],
        nextToken: undefined,
      });

      const result = await service.listLogStreams({
        logGroupName: '/ecs/ally-prd-svc-core',
      });

      expect(mockClient.send).toHaveBeenCalledWith(
        expect.any(DescribeLogStreamsCommand),
      );
      expect(result.streams).toEqual([
        { logStreamName: 'stream-a', lastEventTimestamp: 5000 },
      ]);
    });
  });
});
