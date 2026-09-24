import { BugHunterFinderDataService } from '../bug-hunter-finder-data.service';

describe('BugHunterFinderDataService', () => {
  let service: BugHunterFinderDataService;
  let logsService: { getLogEvents: jest.Mock };
  let findingRepository: { listNewReportedBugs: jest.Mock };
  let posthog: { enabled: boolean; query: jest.Mock };

  beforeEach(() => {
    logsService = { getLogEvents: jest.fn() };
    findingRepository = {
      listNewReportedBugs: jest.fn().mockResolvedValue([]),
    };
    posthog = { enabled: true, query: jest.fn() };
    service = new BugHunterFinderDataService(
      logsService as any,
      findingRepository as any,
      posthog as any,
    );
  });

  describe('getRecentErrors', () => {
    it('returns null for a repo with no CloudWatch log group (frontend repos)', async () => {
      const result = await service.getRecentErrors('ally-web');
      expect(result).toBeNull();
      expect(logsService.getLogEvents).not.toHaveBeenCalled();
    });

    it('queries the last 24h of ERROR-level events for a backend repo', async () => {
      logsService.getLogEvents.mockResolvedValue({
        events: [
          {
            message: 'boom',
            timestamp: 123,
            logStreamName: 'stream-a',
            eventId: 'e1',
          },
        ],
      });

      const result = await service.getRecentErrors('ally-be');

      expect(logsService.getLogEvents).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'ally-be', level: 'ERROR' }),
      );
      const [[query]] = logsService.getLogEvents.mock.calls;
      expect(query.endTime - query.startTime).toBe(24 * 60 * 60 * 1000);
      expect(result).toEqual([
        { message: 'boom', timestamp: 123, logStreamName: 'stream-a' },
      ]);
    });
  });

  describe('getReportedBugs', () => {
    it('reads the NEW, source=reported_bug BugFinding rows', async () => {
      await service.getReportedBugs();

      expect(findingRepository.listNewReportedBugs).toHaveBeenCalled();
    });

    it('maps rows to the finder-facing shape, exposing both the finding id and the roadmap opportunity id', async () => {
      findingRepository.listNewReportedBugs.mockResolvedValue([
        {
          id: 'finding-1',
          reportedBugId: 'opp-1',
          description: 'Login button does nothing on Safari',
          createdAt: new Date('2026-08-01'),
        },
      ]);

      const result = await service.getReportedBugs();

      expect(result).toEqual([
        {
          id: 'finding-1',
          reportedBugId: 'opp-1',
          description: 'Login button does nothing on Safari',
          createdAt: new Date('2026-08-01'),
        },
      ]);
    });
  });

  describe('hasLogGroup', () => {
    it('is true for the three backend repos', () => {
      expect(service.hasLogGroup('ally-be')).toBe(true);
      expect(service.hasLogGroup('ally-ai')).toBe(true);
      expect(service.hasLogGroup('ally-ai-learn')).toBe(true);
    });

    it('is false for the frontend repos, which have no CloudWatch log group', () => {
      expect(service.hasLogGroup('ally-web')).toBe(false);
      expect(service.hasLogGroup('ally-mobile')).toBe(false);
    });
  });

  describe('hasExternalSignal', () => {
    it('is true for a repo with a CloudWatch log group', () => {
      expect(service.hasExternalSignal('ally-be')).toBe(true);
    });

    it('is true for ally-web, which has no log group but does have PostHog exceptions', () => {
      expect(service.hasExternalSignal('ally-web')).toBe(true);
    });

    it('is false for a repo with neither', () => {
      expect(service.hasExternalSignal('ally-mobile')).toBe(false);
    });
  });

  describe('getWebErrors', () => {
    it('returns null for a repo with no PostHog-instrumented client', async () => {
      const result = await service.getWebErrors('ally-be');
      expect(result).toBeNull();
      expect(posthog.query).not.toHaveBeenCalled();
    });

    it('returns an empty list without querying when PostHog is not configured', async () => {
      posthog.enabled = false;

      const result = await service.getWebErrors('ally-web');

      expect(result).toEqual([]);
      expect(posthog.query).not.toHaveBeenCalled();
    });

    it('maps grouped HogQL rows to the finder-facing shape', async () => {
      posthog.query.mockResolvedValue({
        columns: ['type', 'message', 'url', 'occurrences', 'lastSeen'],
        results: [
          [
            'TypeError',
            'Cannot read properties of undefined',
            'https://admin.helloally.ai/bug-hunter',
            7,
            '2026-09-18T00:00:00.000Z',
          ],
        ],
      });

      const result = await service.getWebErrors('ally-web');

      expect(result).toEqual([
        {
          type: 'TypeError',
          message: 'Cannot read properties of undefined',
          url: 'https://admin.helloally.ai/bug-hunter',
          occurrences: 7,
          lastSeen: '2026-09-18T00:00:00.000Z',
        },
      ]);
    });

    it('redacts an email or phone number caught inside an exception message', async () => {
      posthog.query.mockResolvedValue({
        columns: ['type', 'message', 'url', 'occurrences', 'lastSeen'],
        results: [
          [
            'Error',
            'Failed to notify user@example.com at +1 415-555-0100',
            'https://admin.helloally.ai/x',
            2,
            '2026-09-18T00:00:00.000Z',
          ],
        ],
      });

      const [result] = (await service.getWebErrors('ally-web'))!;

      expect(result.message).toBe('Failed to notify [email] at [phone]');
    });

    it('returns an empty list rather than throwing when the PostHog query fails', async () => {
      posthog.query.mockRejectedValue(new Error('self-hosted PostHog is down'));

      const result = await service.getWebErrors('ally-web');

      expect(result).toEqual([]);
    });
  });
});
