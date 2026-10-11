import { BugHunterService, SCORECARD_SERIES_DAYS } from '../bug-hunter.service';

/**
 * `summarizeRuns` is the thin layer between the scorecard route and the two
 * repository aggregates. What it owns: turning "days" into a start instant,
 * "no days" into all time, and an unknown reader zone into UTC instead of a
 * Postgres error.
 */
describe('BugHunterService.summarizeRuns', () => {
  const NOW = new Date('2026-10-05T10:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  const build = () => {
    const runRepository = {
      summarize: jest.fn().mockResolvedValue({ runs: 1, costUsd: 2 }),
      dailySeries: jest.fn().mockResolvedValue([]),
    };
    const service = new BugHunterService(
      {} as never,
      runRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { charge: jest.fn(), chargeRun: jest.fn() } as never, // budget (OPP-0775)
    );
    return { service, runRepository };
  };

  it('starts the window `days` before now', async () => {
    const { service, runRepository } = build();
    const result = await service.summarizeRuns(30, 'Asia/Kolkata', NOW);
    expect(runRepository.summarize).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 30 * DAY),
    );
    expect(result.days).toBe(30);
  });

  it('totals all time when no window is given', async () => {
    const { service, runRepository } = build();
    const result = await service.summarizeRuns(undefined, undefined, NOW);
    expect(runRepository.summarize).toHaveBeenCalledWith(null);
    expect(result.days).toBeNull();
  });

  it('draws the fourteen-day series in the reader zone and reports the zone it used', async () => {
    const { service, runRepository } = build();
    const result = await service.summarizeRuns(7, 'Asia/Kolkata', NOW);
    expect(runRepository.dailySeries).toHaveBeenCalledWith(
      SCORECARD_SERIES_DAYS,
      'Asia/Kolkata',
    );
    expect(result.timeZone).toBe('Asia/Kolkata');
  });

  it('falls back to UTC for a zone Postgres would reject', async () => {
    const { service, runRepository } = build();
    const result = await service.summarizeRuns(7, 'Mars/Olympus_Mons', NOW);
    expect(runRepository.dailySeries).toHaveBeenCalledWith(
      SCORECARD_SERIES_DAYS,
      'UTC',
    );
    expect(result.timeZone).toBe('UTC');
  });

  it('returns both halves together', async () => {
    const { service } = build();
    const result = await service.summarizeRuns(7, undefined, NOW);
    expect(result.window).toEqual({ runs: 1, costUsd: 2 });
    expect(result.series).toEqual([]);
  });
});
