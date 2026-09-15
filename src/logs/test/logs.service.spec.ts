import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LogsService } from '../logs.service';
import { CloudWatchLogsService } from '../../aws/service/cloudwatch-logs.service';
import { AppConfigService } from '../../config/config.service';
import { AwsLogServiceKey } from '../../config/config.service';

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
          'ally-ai': '/ecs/ally-prd-svc-ai-core',
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

  /** Resolve the filterPattern the service actually sent to CloudWatch. */
  const patternFor = async (query: {
    service: AwsLogServiceKey;
    level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
    search?: string;
  }): Promise<string | undefined> => {
    mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
      events: [],
      nextToken: undefined,
    });
    await service.getLogEvents({
      startTime: 1000,
      endTime: 2000,
      limit: 200,
      ...query,
    });
    const calls = mockCloudWatchLogsService.filterLogEvents.mock.calls;
    return calls[calls.length - 1][0].filterPattern;
  };

  describe('buildFilterPattern', () => {
    it('sends no filter pattern when neither level nor search is set', async () => {
      await expect(patternFor({ service: 'ally-be' })).resolves.toBeUndefined();
    });

    // The bug: CloudWatch filter patterns are case-sensitive, and ally-be's
    // winston logger writes its level lowercase, so the DTO's "ERROR" matched
    // nothing at all. The two python services spell it the other way.
    describe('level alone resolves to the token that service actually logs', () => {
      const cases: [AwsLogServiceKey, string, string][] = [
        ['ally-be', 'ERROR', '"error"'],
        ['ally-be', 'WARN', '"warn"'],
        ['ally-be', 'INFO', '"info"'],
        ['ally-be', 'DEBUG', '"debug"'],
        ['ally-ai', 'ERROR', '"[ERROR]"'],
        // python's levelname for WARN is the longer "WARNING".
        ['ally-ai', 'WARN', '"[WARNING]"'],
        ['ally-ai', 'INFO', '"[INFO]"'],
        ['ally-ai', 'DEBUG', '"[DEBUG]"'],
        ['ally-ai-learn', 'ERROR', '"[ERROR]"'],
        ['ally-ai-learn', 'WARN', '"[WARNING]"'],
        ['ally-ai-learn', 'INFO', '"[INFO]"'],
        ['ally-ai-learn', 'DEBUG', '"[DEBUG]"'],
      ];

      it.each(cases)('%s / %s -> %s', async (svc, level, expected) => {
        await expect(
          patternFor({ service: svc, level: level as any }),
        ).resolves.toBe(expected);
      });
    });

    it('never emits an uppercase level token for ally-be', async () => {
      for (const level of ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const) {
        const pattern = await patternFor({ service: 'ally-be', level });
        expect(pattern).toBe(`"${level.toLowerCase()}"`);
      }
    });

    it('passes search through on its own, with no level token', async () => {
      await expect(
        patternFor({ service: 'ally-be', search: 'CryptoService' }),
      ).resolves.toBe('"CryptoService"');
    });

    it('strips embedded quotes from search so the pattern stays parseable', async () => {
      await expect(
        patternFor({ service: 'ally-be', search: 'say "hi"' }),
      ).resolves.toBe('"say hi"');
    });

    // CloudWatch cannot mix AND (quoted terms) with OR (?term), so resolving
    // level to a single token per service is what keeps this combination a
    // plain AND for every service.
    describe('level + search AND together', () => {
      const cases: [AwsLogServiceKey, string][] = [
        ['ally-be', '"error" "CryptoService"'],
        ['ally-ai', '"[ERROR]" "CryptoService"'],
        ['ally-ai-learn', '"[ERROR]" "CryptoService"'],
      ];

      it.each(cases)('%s -> %s', async (svc, expected) => {
        await expect(
          patternFor({
            service: svc,
            level: 'ERROR',
            search: 'CryptoService',
          }),
        ).resolves.toBe(expected);
      });
    });
  });

  describe('getLogEvents', () => {
    it('resolves the log group and maps the returned events', async () => {
      mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
        events: [
          {
            timestamp: 1000,
            message: 'error: boom',
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
          filterPattern: '"error" "boom"',
        }),
      );
      expect(result.events).toEqual([
        {
          timestamp: 1000,
          message: 'error: boom',
          logStreamName: 'stream-a',
          eventId: 'evt-1',
        },
      ]);
    });

    it('throws a BadRequestException when the service has no configured log group', async () => {
      mockConfig.awsLogs.logGroups['ally-ai'] = undefined;
      await expect(
        service.getLogEvents({
          service: 'ally-ai',
          startTime: 1000,
          endTime: 2000,
          limit: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // FilterLogEvents scans a bounded slice per call, so a selective filter
    // over a wide window returns empty pages that still carry a nextToken.
    // Returning the first one would render as "no results".
    it('follows the cursor past empty pages until it has events', async () => {
      mockCloudWatchLogsService.filterLogEvents
        .mockResolvedValueOnce({ events: [], nextToken: 'tok-1' })
        .mockResolvedValueOnce({ events: [], nextToken: 'tok-2' })
        .mockResolvedValueOnce({
          events: [
            {
              timestamp: 5,
              message: 'error: found it',
              logStreamName: 's',
              eventId: 'e',
            },
          ],
          nextToken: 'tok-3',
        });

      const result = await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        level: 'ERROR',
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledTimes(
        3,
      );
      expect(
        mockCloudWatchLogsService.filterLogEvents.mock.calls[1][0].nextToken,
      ).toBe('tok-1');
      expect(result.events).toHaveLength(1);
      expect(result.nextToken).toBe('tok-3');
    });

    it('stops as soon as a page has events, leaving limit semantics intact', async () => {
      mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
        events: [
          { timestamp: 1, message: 'a', logStreamName: 's', eventId: 'e' },
        ],
        nextToken: 'tok-1',
      });

      const result = await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledTimes(
        1,
      );
      expect(result.nextToken).toBe('tok-1');
    });

    it('stops at the last page when the scan genuinely runs out', async () => {
      mockCloudWatchLogsService.filterLogEvents
        .mockResolvedValueOnce({ events: [], nextToken: 'tok-1' })
        .mockResolvedValueOnce({ events: [], nextToken: undefined });

      const result = await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        level: 'ERROR',
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledTimes(
        2,
      );
      expect(result.events).toEqual([]);
      expect(result.nextToken).toBeUndefined();
    });

    // A week-wide window with a rare filter really can page forever — 7 days
    // of ally-ai holds 7 [ERROR] lines spread over 178 pages — so the follow
    // is capped and the cursor handed back for "Next" to resume the scan.
    it('caps the follow and returns the cursor so the caller can resume', async () => {
      mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
        events: [],
        nextToken: 'tok-more',
      });

      const result = await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        level: 'ERROR',
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledTimes(
        201,
      );
      expect(result.events).toEqual([]);
      expect(result.nextToken).toBe('tok-more');
    });

    it('resumes from a caller-supplied nextToken', async () => {
      mockCloudWatchLogsService.filterLogEvents.mockResolvedValue({
        events: [
          { timestamp: 1, message: 'a', logStreamName: 's', eventId: 'e' },
        ],
        nextToken: undefined,
      });

      await service.getLogEvents({
        service: 'ally-be',
        startTime: 1000,
        endTime: 2000,
        nextToken: 'caller-tok',
        limit: 200,
      });

      expect(mockCloudWatchLogsService.filterLogEvents).toHaveBeenCalledWith(
        expect.objectContaining({ nextToken: 'caller-tok' }),
      );
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
