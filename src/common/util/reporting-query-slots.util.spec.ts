import {
  REPORTING_QUERY_SLOT_LIMIT,
  reportingQuerySlotsInUse,
  withReportingQuerySlot,
} from './reporting-query-slots.util';

/**
 * The gate exists to stop a reporting page claiming the connection pool out
 * from under the live paths. Three things have to hold, and a typecheck sees
 * none of them: the ceiling is never exceeded, a slot is always given back
 * (including when the query throws), and results still reach their caller
 * in order.
 */
describe('withReportingQuerySlot', () => {
  afterEach(() => {
    // A leaked slot does not fail the test that leaked it — it fails whichever
    // test runs next, which is the worst way to find out.
    expect(reportingQuerySlotsInUse()).toBe(0);
  });

  it('never exceeds the global ceiling', async () => {
    let inFlight = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: REPORTING_QUERY_SLOT_LIMIT * 4 }, () =>
        withReportingQuerySlot(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 1));
          inFlight -= 1;
        }),
      ),
    );

    expect(peak).toBe(REPORTING_QUERY_SLOT_LIMIT);
  });

  it('returns each result to its own caller', async () => {
    const results = await Promise.all(
      Array.from({ length: REPORTING_QUERY_SLOT_LIMIT * 3 }, (_, i) =>
        withReportingQuerySlot(async () => i * 2),
      ),
    );

    expect(results).toEqual(
      Array.from({ length: REPORTING_QUERY_SLOT_LIMIT * 3 }, (_, i) => i * 2),
    );
  });

  it('propagates a failure and still releases the slot', async () => {
    await expect(
      withReportingQuerySlot(async () => {
        throw new Error('canceling statement due to statement timeout');
      }),
    ).rejects.toThrow('statement timeout');

    // The real risk: a statement timeout retires a slot permanently, and after
    // eight of them the process serves nothing until it is restarted.
    await expect(withReportingQuerySlot(async () => 'ok')).resolves.toBe('ok');
  });

  it('keeps the ceiling honest when a caller barges in as one is released', async () => {
    let inFlight = 0;
    let peak = 0;

    const track = () =>
      withReportingQuerySlot(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      });

    // Fill every slot, then add more mid-flight — the window a decrement-then-
    // wake release would let a fresh caller slip through.
    const first = Array.from({ length: REPORTING_QUERY_SLOT_LIMIT }, track);
    const second = Array.from(
      { length: REPORTING_QUERY_SLOT_LIMIT * 2 },
      track,
    );

    await Promise.all([...first, ...second]);

    expect(peak).toBe(REPORTING_QUERY_SLOT_LIMIT);
  });
});
