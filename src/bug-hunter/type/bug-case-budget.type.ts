/**
 * The budget on one bug's case file — OPP-0775.
 *
 * Every move Bug Hunter makes on a bug spends something: a fix session is a
 * CI run, an attempt is a test-and-fix loop, an escalation is a person's
 * attention, and all of it is dollars and minutes. Until now those caps lived
 * in the workflow file (a wall-clock timeout), in the prompt text ("two
 * attempts") and in the admin's patience. The 6 October incident, where two
 * runs idled for two hours after finishing, is what a budget nobody owns
 * looks like.
 *
 * So the caps live on the finding, and every move decrements them. The
 * orchestrator (OPP-0783) will read these before choosing a move; today the
 * one hard gate is session start, and the counters are shown in the drawer.
 *
 * Stored as one `budget` jsonb column rather than ten numeric columns: the
 * set of things we meter will grow (a Verifier run is a new kind), caps and
 * used always travel together, and nothing queries them in SQL.
 */
export const BUG_CASE_BUDGET_KINDS = [
  'sessions',
  'attempts',
  'escalations',
  'usd',
  'minutes',
] as const;
export type BugCaseBudgetKind = (typeof BUG_CASE_BUDGET_KINDS)[number];

export type BugCaseBudgetAmounts = Record<BugCaseBudgetKind, number>;

export interface BugCaseBudget {
  caps: BugCaseBudgetAmounts;
  used: BugCaseBudgetAmounts;
  /** Set the first time a cap is reached; cleared when a person overrides. */
  exhausted: { kind: BugCaseBudgetKind; at: string } | null;
  /** The admin who last started a session past the cap, and when. */
  overriddenBy: number | null;
  overriddenAt: string | null;
}

/**
 * Defaults per bug. Deliberately modest: the point of a budget is to make
 * "try again" a decision rather than a reflex. Sessions and attempts match
 * what the fix protocol already allows (two attempts per session, two
 * sessions before a person is asked); dollars and minutes are a ceiling well
 * above what a healthy fix costs today ($2–5, 15–40 minutes) and well below
 * what the idle loop burned.
 */
export const BUG_CASE_BUDGET_DEFAULTS: BugCaseBudgetAmounts = {
  sessions: 2,
  attempts: 4,
  escalations: 1,
  usd: 15,
  minutes: 120,
};

const ZERO: BugCaseBudgetAmounts = {
  sessions: 0,
  attempts: 0,
  escalations: 0,
  usd: 0,
  minutes: 0,
};

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** A full budget from whatever is stored — null, partial, or hand-edited. */
export function withBudgetDefaults(
  stored: Partial<BugCaseBudget> | null | undefined,
  defaults: BugCaseBudgetAmounts = BUG_CASE_BUDGET_DEFAULTS,
): BugCaseBudget {
  const caps = { ...defaults };
  const used = { ...ZERO };
  for (const kind of BUG_CASE_BUDGET_KINDS) {
    caps[kind] = num(stored?.caps?.[kind], defaults[kind]);
    used[kind] = num(stored?.used?.[kind], 0);
  }
  const exhausted =
    stored?.exhausted &&
    BUG_CASE_BUDGET_KINDS.includes(stored.exhausted.kind) &&
    typeof stored.exhausted.at === 'string'
      ? { kind: stored.exhausted.kind, at: stored.exhausted.at }
      : null;
  return {
    caps,
    used,
    exhausted,
    overriddenBy:
      typeof stored?.overriddenBy === 'number' ? stored.overriddenBy : null,
    overriddenAt:
      typeof stored?.overriddenAt === 'string' ? stored.overriddenAt : null,
  };
}

/** The first kind whose cap is met or passed, or null while everything is under. */
export function exceededKind(budget: BugCaseBudget): BugCaseBudgetKind | null {
  for (const kind of BUG_CASE_BUDGET_KINDS) {
    if (budget.caps[kind] > 0 && budget.used[kind] >= budget.caps[kind])
      return kind;
  }
  return null;
}

/**
 * Spend `amount` of `kind`. Returns the new budget; sets `exhausted` the first
 * time a cap is reached and leaves an existing `exhausted` alone (the first
 * breach is the one worth knowing about).
 */
export function chargeBudget(
  budget: BugCaseBudget,
  kind: BugCaseBudgetKind,
  amount: number,
  now: Date = new Date(),
): BugCaseBudget {
  if (!(amount > 0)) return budget;
  const used = { ...budget.used, [kind]: round(budget.used[kind] + amount) };
  const next: BugCaseBudget = { ...budget, used };
  if (!next.exhausted) {
    const hit = exceededKind(next);
    if (hit) next.exhausted = { kind: hit, at: now.toISOString() };
  }
  return next;
}

/** A person starting a session past the cap: recorded, and the exhausted flag lifted so the next breach is noticed again. */
export function overrideBudget(
  budget: BugCaseBudget,
  userId: number,
  now: Date = new Date(),
): BugCaseBudget {
  return {
    ...budget,
    exhausted: null,
    overriddenBy: userId,
    overriddenAt: now.toISOString(),
  };
}

/** Why a session cannot start, in the words shown to the admin, or null when it can. */
export function explainSessionRefusal(budget: BugCaseBudget): string | null {
  const kind = exceededKind(budget);
  if (!kind) return null;
  const words: Record<BugCaseBudgetKind, string> = {
    sessions: `I have already run ${budget.used.sessions} fix session${budget.used.sessions === 1 ? '' : 's'} on this bug, which is the budget.`,
    attempts: `I have made ${budget.used.attempts} fix attempts on this bug, which is the budget.`,
    escalations: `I have already asked for help on this bug ${budget.used.escalations} time${budget.used.escalations === 1 ? '' : 's'}, which is the budget.`,
    usd: `I have spent $${budget.used.usd.toFixed(2)} on this bug against a budget of $${budget.caps.usd.toFixed(2)}.`,
    minutes: `I have spent ${Math.round(budget.used.minutes)} minutes on this bug against a budget of ${budget.caps.minutes}.`,
  };
  return `${words[kind]} Read what the last session left behind before starting another; if you still want one, start it anyway and I will note that you overrode the budget.`;
}

const round = (n: number): number => Math.round(n * 10000) / 10000;
