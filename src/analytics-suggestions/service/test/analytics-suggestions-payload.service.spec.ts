import {
  AnalyticsSuggestionsPayloadService,
  compact,
} from '../analytics-suggestions-payload.service';
import { SUGGESTION_PAYLOAD_LIMITS } from '../../constants/analytics-suggestions.constants';

/** A service whose getX() resolves to `value`. */
const ok = (method: string, value: unknown) => ({
  [method]: jest.fn().mockResolvedValue(value),
});

/** A service whose getX() rejects. */
const fails = (method: string, message: string) => ({
  [method]: jest.fn().mockRejectedValue(new Error(message)),
});

describe('AnalyticsSuggestionsPayloadService', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const deps: Record<string, unknown> = {
      dataSource: { query: jest.fn().mockResolvedValue([{ floor: null }]) },
      platformAnalytics: ok('getOverview', { summary: { users: 10 } }),
      highlights: ok('getHighlights', { summary: { activeOrgs: 3 } }),
      activation: ok('getActivation', { series: [] }),
      completionRate: ok('getCompletionRate', { series: [] }),
      languageMix: ok('getLanguageMix', { series: [] }),
      qualityDistribution: ok('getQualityDistribution', { buckets: [] }),
      coachingLoop: ok('getCoachingLoop', { series: [] }),
      scribeAdoption: ok('getScribeAdoption', { series: [] }),
      scribe: ok('getOverview', { summary: {} }),
      orgHealth: ok('getOrgHealth', { orgs: [] }),
      usageLevels: ok('getUsageLevels', { months: [] }),
      roleplayVolume: ok('getRoleplayVolume', { bands: [] }),
      skillGrowth: ok('getSkillGrowth', { points: [] }),
      competencyMap: ok('getCompetencyMap', { competencies: [] }),
      trackDropoff: ok('getTrackDropoff', { items: [] }),
      ...overrides,
    };

    return new AnalyticsSuggestionsPayloadService(
      deps.dataSource as never,
      deps.platformAnalytics as never,
      deps.highlights as never,
      deps.activation as never,
      deps.completionRate as never,
      deps.languageMix as never,
      deps.qualityDistribution as never,
      deps.coachingLoop as never,
      deps.scribeAdoption as never,
      deps.scribe as never,
      deps.orgHealth as never,
      deps.usageLevels as never,
      deps.roleplayVolume as never,
      deps.skillGrowth as never,
      deps.competencyMap as never,
      deps.trackDropoff as never,
    );
  };

  it('reads every section and reports them as included', async () => {
    const result = await build().collect({ range: '30d' });

    expect(result.included).toHaveLength(15);
    expect(result.failed).toEqual([]);
    expect(result.sections.platformOverview).toEqual({
      summary: { users: 10 },
    });
  });

  it('reports a failed section instead of failing the whole run', async () => {
    const result = await build({
      scribe: fails(
        'getOverview',
        'range=all is not supported by this endpoint',
      ),
    }).collect({ range: 'all' });

    expect(result.sections.scribeOverview).toBeUndefined();
    expect(result.failed).toContain(
      'scribeOverview: range=all is not supported by this endpoint',
    );
    // The other fourteen still made it.
    expect(result.included).toHaveLength(14);
  });

  it('labels the windowless sections as all-time', async () => {
    const result = await build().collect({ range: '30d' });

    expect(result.sections.orgHealth).toMatchObject({ allTime: true });
    expect(result.sections.competencyMap).toMatchObject({ allTime: true });
    // A windowed section carries no such flag.
    expect(result.sections.platformOverview).not.toHaveProperty('allTime');
  });

  it('passes the window through to the windowed services only', async () => {
    const highlights = ok('getHighlights', { summary: {} });
    const orgHealth = ok('getOrgHealth', { orgs: [] });

    await build({ highlights, orgHealth }).collect({
      from: '2026-01-01',
      to: '2026-03-31',
    });

    expect(
      (highlights as { getHighlights: jest.Mock }).getHighlights,
    ).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-03-31' });
    expect(
      (orgHealth as { getOrgHealth: jest.Mock }).getOrgHealth,
    ).toHaveBeenCalledWith({});
  });

  it('drops an oversized section and names it rather than truncating it', async () => {
    const huge = {
      summary: Object.fromEntries(
        Array.from({ length: 2000 }, (_, i) => [`metric_${i}`, i]),
      ),
    };

    const result = await build({
      platformAnalytics: ok('getOverview', huge),
    }).collect({ range: '30d' });

    expect(result.sections.platformOverview).toBeUndefined();
    expect(result.failed.join(' ')).toContain(
      'platformOverview: too large for the prompt',
    );
  });

  it('resolves a preset window and reports `to` inclusively', async () => {
    const result = await build().collect({ range: '30d' });

    expect(result.window.range).toBe('30d');
    expect(result.window.label).toBe('Last 30 days');
    // 30 days inclusive of today.
    const from = new Date(`${result.window.from}T00:00:00Z`);
    const to = new Date(`${result.window.to}T00:00:00Z`);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(29);
  });

  it('reports a custom window with no range, exactly as asked for', async () => {
    const result = await build().collect({
      from: '2026-01-01',
      to: '2026-03-31',
    });

    expect(result.window).toEqual({
      range: null,
      from: '2026-01-01',
      to: '2026-03-31',
      label: '2026-01-01 → 2026-03-31',
    });
  });

  it('measures the data floor only for an all-time window', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ floor: '2025-01-01' }]),
    };

    await build({ dataSource }).collect({ range: '30d' });
    expect(dataSource.query).not.toHaveBeenCalled();

    await build({ dataSource }).collect({ range: 'all' });
    expect(dataSource.query).toHaveBeenCalled();
  });
});

describe('compact', () => {
  it('rounds floats and leaves integers alone', () => {
    expect(compact({ a: 4.666666, b: 12 })).toEqual({ a: 4.67, b: 12 });
  });

  it('keeps the tail of a time series and says how much it dropped', () => {
    const series = Array.from({ length: 40 }, (_, i) => ({
      bucket: `2026-01-${String(i + 1).padStart(2, '0')}`,
      n: i,
    }));

    const result = compact(series) as { _note: string; items: unknown[] };

    expect(result.items).toHaveLength(SUGGESTION_PAYLOAD_LIMITS.SERIES_POINTS);
    expect(result._note).toBe('showing the latest 12 of 40 periods');
    // The tail, because recent periods are what a suggestion is about.
    expect((result.items[result.items.length - 1] as { n: number }).n).toBe(39);
  });

  it('keeps the head of a ranked list and says how much it dropped', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      org: `org-${i}`,
      score: 100 - i,
    }));

    const result = compact(rows) as { _note: string; items: unknown[] };

    expect(result.items).toHaveLength(SUGGESTION_PAYLOAD_LIMITS.LIST_ROWS);
    expect(result._note).toBe('showing the top 15 of 30 rows');
    expect((result.items[0] as { org: string }).org).toBe('org-0');
  });

  it('leaves a short array as an array', () => {
    expect(compact([{ bucket: '2026-01-01', n: 1 }])).toEqual([
      { bucket: '2026-01-01', n: 1 },
    ]);
  });

  it('recurses into nested structures', () => {
    expect(
      compact({ outer: { inner: [{ value: 1.23456 }], n: null } }),
    ).toEqual({ outer: { inner: [{ value: 1.23 }], n: null } });
  });
});
