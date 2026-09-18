import { GlossaryAdherenceService } from '../glossary-adherence.service';
import { GlossaryAdherenceSchedulerRegistrationService } from '../glossary-adherence-scheduler-registration.service';
import { scheduledTaskRegistry } from '../../../scheduler/registry/scheduled-task.registry';

/**
 * The adherence scan is the one measurement that separates "the glossary is
 * wrong" from "the glossary is not being followed" — Kannada runs 0.625
 * violations per agent message against Hindi's 0.024, on terms the glossary
 * names explicitly. It was readable on 1.5% of eligible sessions, because the
 * per-session scan was only added at session end in August and 664 earlier
 * sessions were never scanned.
 *
 * What these tests protect is the selector, because getting it wrong is silent.
 */
describe('GlossaryAdherenceService.catchUpUnscanned', () => {
  let query: jest.Mock;
  let analyze: jest.Mock;
  let service: GlossaryAdherenceService;

  const build = (ids: string[] = ['s1', 's2']) => {
    query = jest.fn().mockResolvedValue(ids.map((id) => ({ id })));
    service = new GlossaryAdherenceService(
      {} as never,
      {} as never,
      { query } as never,
    );
    analyze = jest.fn().mockResolvedValue({ totalViolations: 1 });
    (service as never as { analyzeSession: unknown }).analyzeSession = analyze;
    return service;
  };

  const sql = () => String(query.mock.calls[0][0]);

  it('takes only sessions that have no report yet', async () => {
    // Without this the run repeats the previous run's work and a bounded run
    // never advances — which is why backfillLanguage cannot drain a backlog.
    await build().catchUpUnscanned();
    expect(sql()).toMatch(/NOT EXISTS[\s\S]*glossary_adherence_reports/);
  });

  it('requires the language to have a published glossary with avoid-terms', async () => {
    // The gate belongs in the QUERY, not in analyzeSession's `return null`. A
    // session that legitimately yields no report writes no row, so a selector
    // keyed only on "no report exists" would reselect it every tick forever —
    // the same mistake that once stalled the language judge, where 25 sessions
    // with no AI turns starved everything else.
    await build().catchUpUnscanned();
    const s = sql();
    expect(s).toMatch(/language_glossary_sections/);
    expect(s).toMatch(/status = 'published'/);
    // The group test must stay in step with parseAvoidTerms, which accepts
    // `(not …)` and `(avoid …)` as well as `(avoid: …)`. Pinning the literal
    // `(avoid:` here is what let a reworded glossary fall out of scanning
    // entirely, so assert BOTH markers are covered.
    expect(s).toMatch(/avoid\|not/);
  });

  it('requires at least one agent message to scan', async () => {
    await build().catchUpUnscanned();
    expect(sql()).toMatch(/"senderId" = -1/);
  });

  it('excludes preview and seed rooms', async () => {
    await build().catchUpUnscanned();
    expect(sql()).toMatch(/preview-/);
    expect(sql()).toMatch(/seed-room-/);
  });

  it('scans newest first and bounds the chunk', async () => {
    // Newest first so a fresh gap closes before ancient history, and bounded so
    // a tick finishes well inside its 30-minute window.
    await build().catchUpUnscanned();
    expect(sql()).toMatch(/ORDER BY s\."createdAt" DESC/);
    expect(sql()).toMatch(/LIMIT \$2/);
    expect(query.mock.calls[0][1][1]).toBe(150);
  });

  it('counts reported and skipped separately', async () => {
    const svc = build(['a', 'b', 'c']);
    (svc as never as { analyzeSession: unknown }).analyzeSession = jest
      .fn()
      .mockResolvedValueOnce({ totalViolations: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ totalViolations: 3 });

    expect(await svc.catchUpUnscanned()).toEqual({
      scanned: 3,
      reported: 2,
      skipped: 1,
    });
  });

  it('one failing session does not sink the chunk', async () => {
    const svc = build(['a', 'b']);
    (svc as never as { analyzeSession: unknown }).analyzeSession = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ totalViolations: 0 });

    expect(await svc.catchUpUnscanned()).toEqual({
      scanned: 2,
      reported: 1,
      skipped: 1,
    });
  });

  it('reports nothing to do without erroring', async () => {
    expect(await build([]).catchUpUnscanned()).toEqual({
      scanned: 0,
      reported: 0,
      skipped: 0,
    });
  });
});

describe('GlossaryAdherenceSchedulerRegistrationService', () => {
  it('registers the catch-up on the shared 30-minute scheduler', () => {
    const adherence = { catchUpUnscanned: jest.fn().mockResolvedValue({}) };
    new GlossaryAdherenceSchedulerRegistrationService(
      adherence as never,
    ).onModuleInit();

    const names = scheduledTaskRegistry
      .getHandlers('30min')
      .map((t) => t.taskName);
    expect(names).toContain('glossary-adherence-catchup');
  });
});
