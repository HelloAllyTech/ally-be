import {
  BUG_CASE_BUDGET_DEFAULTS,
  chargeBudget,
  exceededKind,
  explainSessionRefusal,
  overrideBudget,
  withBudgetDefaults,
} from '../bug-case-budget.type';

describe('bug case budget', () => {
  it('reads a null column as defaults with nothing spent', () => {
    const b = withBudgetDefaults(null);
    expect(b.caps).toEqual(BUG_CASE_BUDGET_DEFAULTS);
    expect(b.used).toEqual({
      sessions: 0,
      attempts: 0,
      escalations: 0,
      usd: 0,
      minutes: 0,
    });
    expect(b.exhausted).toBeNull();
    expect(exceededKind(b)).toBeNull();
  });

  it('keeps stored caps and spend, and repairs anything malformed', () => {
    const b = withBudgetDefaults({
      caps: { sessions: 5 } as never,
      used: { usd: 3.25, attempts: 'two' } as never,
      exhausted: { kind: 'nonsense', at: 'x' } as never,
    });
    expect(b.caps.sessions).toBe(5);
    expect(b.caps.usd).toBe(BUG_CASE_BUDGET_DEFAULTS.usd);
    expect(b.used.usd).toBe(3.25);
    expect(b.used.attempts).toBe(0);
    expect(b.exhausted).toBeNull();
  });

  it('charges a kind and marks the first cap reached, once', () => {
    let b = withBudgetDefaults(null);
    b = chargeBudget(b, 'sessions', 1, new Date('2026-10-07T10:00:00Z'));
    expect(b.used.sessions).toBe(1);
    expect(b.exhausted).toBeNull();

    b = chargeBudget(b, 'sessions', 1, new Date('2026-10-07T11:00:00Z'));
    expect(b.exhausted).toEqual({
      kind: 'sessions',
      at: '2026-10-07T11:00:00.000Z',
    });

    b = chargeBudget(b, 'usd', 20, new Date('2026-10-07T12:00:00Z'));
    expect(b.used.usd).toBe(20);
    // the first breach stays the one on record
    expect(b.exhausted?.kind).toBe('sessions');
  });

  it('ignores a zero or negative charge', () => {
    const b = withBudgetDefaults(null);
    expect(chargeBudget(b, 'usd', 0)).toBe(b);
    expect(chargeBudget(b, 'usd', -1)).toBe(b);
  });

  it('rounds dollars so repeated small charges do not drift', () => {
    let b = withBudgetDefaults(null);
    for (let i = 0; i < 10; i++) b = chargeBudget(b, 'usd', 0.1);
    expect(b.used.usd).toBe(1);
  });

  it('explains a refusal in the words an admin reads, and says nothing while under budget', () => {
    const under = withBudgetDefaults(null);
    expect(explainSessionRefusal(under)).toBeNull();

    const spent = chargeBudget(
      chargeBudget(under, 'sessions', 1),
      'sessions',
      1,
    );
    expect(explainSessionRefusal(spent)).toMatch(
      /already run 2 fix sessions on this bug, which is the budget/,
    );
    expect(explainSessionRefusal(spent)).toMatch(/start it anyway/);
  });

  it('records an override and lifts the exhausted flag so the next breach is seen again', () => {
    const spent = chargeBudget(
      chargeBudget(withBudgetDefaults(null), 'sessions', 1),
      'sessions',
      1,
    );
    const over = overrideBudget(spent, 136, new Date('2026-10-07T13:00:00Z'));
    expect(over.exhausted).toBeNull();
    expect(over.overriddenBy).toBe(136);
    expect(over.overriddenAt).toBe('2026-10-07T13:00:00.000Z');
    // the spend itself is not forgiven: the refusal text still applies
    expect(explainSessionRefusal(over)).not.toBeNull();
  });
});
