import {
  ADMIN_ANALYTICS_CHART_REGISTRY,
  ADMIN_ANALYTICS_CHART_COUNT,
} from '../admin-analytics-chart-registry.constants';

/**
 * Guard for the admin analytics chart registry — the canonical id -> chart map
 * served at GET /v1/analytics/chart-registry. These invariants are what make an
 * "AAQ-0NN" a stable, unambiguous handle for one chart.
 */
describe('ADMIN_ANALYTICS_CHART_REGISTRY', () => {
  it('has at least one entry and COUNT matches length', () => {
    expect(ADMIN_ANALYTICS_CHART_REGISTRY.length).toBeGreaterThan(0);
    expect(ADMIN_ANALYTICS_CHART_COUNT).toBe(
      ADMIN_ANALYTICS_CHART_REGISTRY.length,
    );
  });

  it('every id matches the AAQ-NNN format', () => {
    for (const entry of ADMIN_ANALYTICS_CHART_REGISTRY) {
      expect(entry.id).toMatch(/^AAQ-\d{3}$/);
    }
  });

  it('ids are unique (an id is never reused)', () => {
    const ids = ADMIN_ANALYTICS_CHART_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry carries a title and a component file', () => {
    for (const entry of ADMIN_ANALYTICS_CHART_REGISTRY) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.componentFile.trim().length).toBeGreaterThan(0);
      expect(entry.tab.trim().length).toBeGreaterThan(0);
    }
  });

  it('ids are listed in ascending numeric order', () => {
    const nums = ADMIN_ANALYTICS_CHART_REGISTRY.map((e) =>
      Number(e.id.slice(4)),
    );
    const sorted = [...nums].sort((a, b) => a - b);
    expect(nums).toEqual(sorted);
  });
});
