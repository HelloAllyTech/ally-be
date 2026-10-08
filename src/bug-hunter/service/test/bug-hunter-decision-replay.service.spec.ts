import {
  BugHunterDecisionReplayService,
  outcomeOf,
  samePick,
} from '../bug-hunter-decision-replay.service';
import {
  BugFindingDecisionReason,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';

describe('outcomeOf', () => {
  const f = (status: BugFindingStatus, extra: Record<string, unknown> = {}) =>
    ({ status, decisionReason: null, metadata: {}, ...extra }) as never;

  it('reads merged or released as good, failed or cancelled as bad, the rest as open', () => {
    expect(outcomeOf(f(BugFindingStatus.MERGED))).toBe('good');
    expect(outcomeOf(f(BugFindingStatus.RELEASED))).toBe('good');
    expect(outcomeOf(f(BugFindingStatus.FAILED))).toBe('bad');
    expect(outcomeOf(f(BugFindingStatus.CANCELLED))).toBe('bad');
    expect(outcomeOf(f(BugFindingStatus.FIXING))).toBe('open');
  });

  it('reads a finder-error dismissal as good unless it was later reversed', () => {
    expect(
      outcomeOf(
        f(BugFindingStatus.DISMISSED, {
          decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        }),
      ),
    ).toBe('good');
    expect(
      outcomeOf(
        f(BugFindingStatus.DISMISSED, {
          decisionReason: BugFindingDecisionReason.NOT_A_BUG,
          metadata: { reversedAt: '2026-10-08' },
        }),
      ),
    ).toBe('bad');
    expect(
      outcomeOf(
        f(BugFindingStatus.DISMISSED, {
          decisionReason: BugFindingDecisionReason.WONT_FIX,
        }),
      ),
    ).toBe('open');
  });

  it('reads an open PR by its last Verifier verdict', () => {
    expect(
      outcomeOf(
        f(BugFindingStatus.PR_OPENED, {
          metadata: { fixVerdicts: [{ verdict: 'fail' }, { verdict: 'pass' }] },
        }),
      ),
    ).toBe('good');
    expect(
      outcomeOf(
        f(BugFindingStatus.PR_OPENED, {
          metadata: { fixVerdicts: [{ verdict: 'fail' }] },
        }),
      ),
    ).toBe('open');
  });
});

describe('samePick', () => {
  it('compares a D6 pick by engine and model, a D1 pick as a set, and the rest by value', () => {
    expect(
      samePick(
        { engine: 'gemini', model: 'gemini-2.5-pro', approach: 'a' },
        { engine: 'gemini', model: 'gemini-2.5-pro', approach: null },
      ),
    ).toBe(true);
    expect(samePick(['tests', 'code_review'], ['code_review', 'tests'])).toBe(
      true,
    );
    expect(samePick(['tests'], ['code_review'])).toBe(false);
    expect(samePick('fix', 'fix')).toBe(true);
    expect(samePick('fix', 'ask_human')).toBe(false);
  });
});

describe('BugHunterDecisionReplayService', () => {
  const decision = (over: Record<string, unknown>) => ({
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    point: 'D7',
    findingId: 'f-good',
    pick: 'retry_fix',
    shadowPick: 'ask_human',
    inputs: {},
    outcome: null,
    createdAt: new Date(),
    ...over,
  });

  it('counts agreements, owner wins and shadow wins per point, writes outcomes back, and says when a point should flip', async () => {
    const rows = [
      // D7: 31 disagreements where the owner's pick went bad (shadow wins), 1 good
      ...Array.from({ length: 31 }, (_, i) =>
        decision({ id: `d7-bad-${i}`, findingId: 'f-bad' }),
      ),
      decision({ id: 'd7-good', findingId: 'f-good' }),
      decision({ id: 'd7-agree', pick: 'retry_fix', shadowPick: 'retry_fix' }),
      decision({ id: 'd7-open', findingId: 'f-open' }),
      decision({
        id: 'd7-veto',
        pick: 'ask_human',
        shadowPick: null,
        inputs: { veto: { by: 'budget' } },
      }),
      // D5: too few cases
      decision({
        id: 'd5-1',
        point: 'D5',
        pick: 'fix',
        shadowPick: 'ask_human',
        findingId: 'f-bad',
      }),
      // D8: fixed
      decision({ id: 'd8-1', point: 'D8', pick: 'merge', shadowPick: null }),
    ];
    const updates: [unknown, { outcome: string }][] = [];
    const service = new BugHunterDecisionReplayService(
      {
        find: jest.fn().mockResolvedValue(rows),
        update: jest.fn().mockImplementation((where, set) => {
          updates.push([where, set]);
          return Promise.resolve();
        }),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 'f-good',
            status: BugFindingStatus.MERGED,
            decisionReason: null,
            metadata: {},
          },
          {
            id: 'f-bad',
            status: BugFindingStatus.FAILED,
            decisionReason: null,
            metadata: {},
          },
          {
            id: 'f-open',
            status: BugFindingStatus.FIXING,
            decisionReason: null,
            metadata: {},
          },
        ]),
      } as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          decisionOwners: { D5: 'rule', D8: 'model' },
        }),
      } as never,
    );

    const report = await service.report(90);
    const d7 = report.points.find((p) => p.point === 'D7')!;
    expect(d7).toMatchObject({
      owner: 'rule',
      fixed: false,
      decisions: 35,
      withShadow: 34,
      agreed: 1,
      disagreed: 33,
      ownerWins: 1,
      shadowWins: 31,
      undecided: 1,
      vetoes: 1,
      verdict: 'flip',
    });
    const d5 = report.points.find((p) => p.point === 'D5')!;
    expect(d5).toMatchObject({ owner: 'rule', verdict: 'not_enough_cases' });
    const d8 = report.points.find((p) => p.point === 'D8')!;
    // The setting tried to hand D8 to a model; a fixed point stays the rule.
    expect(d8).toMatchObject({ owner: 'rule', fixed: true, verdict: 'fixed' });

    const worse = updates.find(([, set]) => set.outcome === 'worse');
    expect(worse).toBeDefined();
    const better = updates.find(([, set]) => set.outcome === 'better');
    expect(better).toBeDefined();
  });

  it('effective owners: settings win over defaults, fixed points never move', async () => {
    const service = new BugHunterDecisionReplayService(
      {} as never,
      {} as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          decisionOwners: { D7: 'model', D4: 'model' },
        }),
      } as never,
    );
    expect(await service.effectiveOwners()).toMatchObject({
      D1: 'model',
      D4: 'rule',
      D5: 'model',
      D7: 'model',
      D8: 'rule',
    });
  });
});
