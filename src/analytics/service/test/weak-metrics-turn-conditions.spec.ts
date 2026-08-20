import { WeakMetricsAnalyticsService } from '../weak-metrics-analytics.service';
import { TurnConditionRow } from '../../repository/weak-metrics-analytics.repository';

/**
 * The turn-conditions panel exists to answer a different question from the rest
 * of the tab: not "what is this population's rate" but "what was measurably
 * different about the turns that went wrong". Its value is entirely in the
 * ordering — a reader scans the top factor and stops — so the grouping and the
 * sort are the parts worth pinning down.
 */
describe('WeakMetricsAnalyticsService.turnConditions', () => {
  const service = new WeakMetricsAnalyticsService({} as never, {} as never);

  const build = (rows: Partial<TurnConditionRow>[]) =>
    (service as any).turnConditions(
      rows.map((r) => ({
        factor: 'responseLatencyMs',
        band: 'q1',
        bandOrder: 1,
        lo: null,
        hi: null,
        turns: 100,
        faults: 0,
        ...r,
      })),
    );

  /** A factor with `n` bands whose fault rates are exactly `rates`. */
  const factor = (id: string, rates: number[]): Partial<TurnConditionRow>[] =>
    rates.map((rate, i) => ({
      factor: id,
      band: `q${i + 1}`,
      bandOrder: i + 1,
      turns: 100,
      faults: rate * 100,
    }));

  it('puts the most discriminating factor first', () => {
    // Latency separates its bands by 40 points; reply length by 4. A reader
    // scanning from the top must land on the one that actually distinguishes
    // a bad turn from a good one, not on whichever the database returned first.
    const result = build([
      ...factor('responseChars', [0.2, 0.21, 0.23, 0.24]),
      ...factor('responseLatencyMs', [0.1, 0.2, 0.3, 0.5]),
    ]);

    expect(result.factors.map((f: { id: string }) => f.id)).toEqual([
      'responseLatencyMs',
      'responseChars',
    ]);
    expect(result.factors[0].spread).toBeCloseTo(0.4);
    expect(result.factors[1].spread).toBeCloseTo(0.04);
  });

  it('keeps a factor whose bands barely differ, but ranks it last', () => {
    // A flat factor is a real result — "this doesn't explain anything" — so it
    // is reported rather than hidden. It just must not lead.
    const result = build([
      ...factor('interrupted', [0.3, 0.3]),
      ...factor('responseLatencyMs', [0.1, 0.5]),
    ]);

    expect(result.factors).toHaveLength(2);
    expect(result.factors[1].id).toBe('interrupted');
    expect(result.factors[1].spread).toBe(0);
  });

  it('drops a factor with too few turns behind it', () => {
    // Four quartiles of a dozen turns each produce a wide spread out of pure
    // noise, and a wide spread is exactly what sorts to the top of this panel.
    const result = build([
      ...factor('responseLatencyMs', [0.1, 0.5]).map((r) => ({
        ...r,
        turns: 10,
        faults: 1,
      })),
    ]);

    expect(result.factors).toHaveLength(0);
  });

  it('ignores a factor the copy table does not describe', () => {
    // A new column in the repository must not reach the tab before someone has
    // written what it means to a reader.
    const result = build(factor('someNewColumnMs', [0.1, 0.9]));
    expect(result.factors).toHaveLength(0);
  });

  it('orders bands by bandOrder, not by arrival', () => {
    const result = build([
      { factor: 'responseLatencyMs', band: 'q3', bandOrder: 3, turns: 100 },
      { factor: 'responseLatencyMs', band: 'q1', bandOrder: 1, turns: 100 },
      { factor: 'responseLatencyMs', band: 'q2', bandOrder: 2, turns: 100 },
    ]);

    expect(
      result.factors[0].bands.map((b: { band: string }) => b.band),
    ).toEqual(['q1', 'q2', 'q3']);
  });

  it('reports the baseline the bands are read against', () => {
    // Without it a band at 30% is unreadable — the reader cannot tell whether
    // that is twice the norm or half of it.
    const result = build(factor('responseLatencyMs', [0.1, 0.3]));

    expect(result.totalTurns).toBe(200);
    expect(result.baselineRate).toBeCloseTo(0.2);
  });

  it('survives a band with no turns rather than dividing by zero', () => {
    const result = build([
      { factor: 'responseLatencyMs', bandOrder: 1, turns: 0, faults: 0 },
      { factor: 'responseLatencyMs', bandOrder: 2, turns: 150, faults: 30 },
    ]);

    expect(result.factors[0].bands[0].rate).toBe(0);
    expect(result.baselineRate).toBeCloseTo(0.2);
  });

  it('returns an empty panel rather than throwing when nothing came back', () => {
    const result = (service as any).turnConditions(undefined);
    expect(result.factors).toEqual([]);
    expect(result.totalTurns).toBe(0);
    expect(result.baselineRate).toBeNull();
  });
});
