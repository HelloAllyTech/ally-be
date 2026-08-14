import { BugHunterFinderDataService } from '../bug-hunter-finder-data.service';

describe('BugHunterFinderDataService', () => {
  let service: BugHunterFinderDataService;
  let logsService: { getLogEvents: jest.Mock };
  let findingRepository: { listNewReportedBugs: jest.Mock };

  beforeEach(() => {
    logsService = { getLogEvents: jest.fn() };
    findingRepository = {
      listNewReportedBugs: jest.fn().mockResolvedValue([]),
    };
    service = new BugHunterFinderDataService(
      logsService as any,
      findingRepository as any,
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
});
