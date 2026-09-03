import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { FillerAnalyticsRepository } from '../filler-analytics.repository';

/**
 * The read side. Two things are worth pinning here rather than trusting by
 * inspection: `bucket` is the ONE part of this SQL that is interpolated rather
 * than bound, and the rates depend on a denominator that is easy to get wrong.
 */
describe('FillerAnalyticsRepository.findingRates', () => {
  let repository: FillerAnalyticsRepository;
  let query: jest.Mock;

  const window = { since: '2026-08-01', until: '2026-09-01' };

  beforeEach(async () => {
    query = jest.fn(async () => []);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillerAnalyticsRepository,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();
    repository = module.get(FillerAnalyticsRepository);
  });

  const sqlOf = () => String(query.mock.calls[0][0]);

  it.each([
    ['day', 'day'],
    ['week', 'week'],
    ['month', 'month'],
    ['year', 'year'],
  ] as const)('truncates to %s when asked for %s', async (bucket, trunc) => {
    await repository.findingRates({ ...window, bucket });

    expect(sqlOf()).toContain(`date_trunc('${trunc}'`);
  });

  it('defaults to day when no granularity is given', async () => {
    await repository.findingRates(window);

    expect(sqlOf()).toContain("date_trunc('day'");
  });

  it('never interpolates a granularity it does not recognise', async () => {
    // `bucket` arrives from a query string and is the one value in this SQL
    // that is not a bound parameter, so the whitelist is load-bearing.
    await repository.findingRates({
      ...window,
      bucket: "day') --" as never,
    });

    const sql = sqlOf();
    expect(sql).toContain("date_trunc('day'");
    expect(sql).not.toContain('--');
  });

  it('bounds the window with parameters, not string interpolation', async () => {
    await repository.findingRates(window);

    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('divides by played fillers, not by sessions or turns', async () => {
    // The denominator is the whole point: a session that played forty fillers
    // and one that played two are not comparable units.
    await repository.findingRates(window);
    const sql = sqlOf();

    expect(sql).toContain('SUM(s."fillersJudged")');
    expect(sql).not.toMatch(/COUNT\(DISTINCT\s+s\.id\)/);
  });

  it('keeps conditioned-out findings out of the three model-facing rates', async () => {
    // Those are fillers marked generic on a character the scenario never gave a
    // voice to. Counting them would make a push to configure more scenarios
    // read as a model regression.
    await repository.findingRates(window);
    const sql = sqlOf();

    for (const dimension of ['character_fit', 'context_fit', 'safety']) {
      const clause = new RegExp(
        `a\\."dimension" = '${dimension}'\\s*\\n?\\s*AND NOT a\\."conditionedOut"`,
      );
      expect(sql).toMatch(clause);
    }
  });

  it('still surfaces conditioned-out findings on their own line', async () => {
    // Excluded from the rates, but not hidden — otherwise the configuration
    // gap they represent disappears from the dashboard entirely.
    await repository.findingRates(window);

    expect(sqlOf()).toContain('"unconfiguredStylePer100"');
  });

  it('yields no rate rather than a zero when nothing was played', async () => {
    // 0% "character fit findings" on an empty bucket would read as a clean
    // window; it is an unmeasured one.
    await repository.findingRates(window);

    expect(sqlOf()).toContain('CASE WHEN SUM(s."fillersJudged") > 0');
  });

  it('applies the language filter as a bound parameter', async () => {
    await repository.findingRates({ ...window, language: 'ml' });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('j."language" = $3');
    expect(params).toEqual(['2026-08-01', '2026-09-01', 'ml']);
  });
});
