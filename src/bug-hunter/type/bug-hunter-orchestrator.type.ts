import { BugHunterEngine } from './bug-hunter-model-settings.type';

/** The eight orchestration points. D1–D3 are the Finder's, D4–D8 the orchestrator's. */
export type DecisionPoint =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8';

/**
 * The orchestrator — OPP-0783.
 *
 * Until now the fix-session workflow was the orchestrator: a CI job whose
 * prompt said when to retry, when to escalate and when to ask, and which
 * died with the runner. The orchestrator moves those choices into ally-be as
 * a state machine beside the policy service, with a CLOSED menu of moves.
 * Every move is a decision row (`bug_hunt_decisions`) with an owner, the
 * pick and the pick not taken, so the replay can say later which owner
 * should hold which point.
 *
 * Ownership on day one, as the architecture set it:
 *   D4  which Verifier         fixed rule   (the other vendor where one exists)
 *   D5  fix now or hand over   model-owned, rule shadows
 *   D6  approach and model     model-owned, rule shadows
 *   D7  retry, escalate, ask   rule-owned, model shadows
 *   D8  merge or hand over     fixed rule   (policy + a Verify pass)
 *
 * Budgets and safety veto any of them. A veto is still a decision row — the
 * rule acts, the model is not asked, and the reason names the veto.
 */
export const BUG_HUNTER_MOVES = [
  'run_finder',
  'verify_finding',
  'fix',
  'verify_fix',
  'retry_fix',
  'escalate_model',
  'split_into_plan',
  'ask_human',
  'collapse_stages',
  'close',
] as const;
export type BugHunterMove = (typeof BUG_HUNTER_MOVES)[number];

/** D5: a confirmed finding — fix it now, or hold it for a person. */
export const BUG_HUNTER_D5_MENU = ['fix', 'ask_human'] as const;
export type D5Pick = (typeof BUG_HUNTER_D5_MENU)[number];

/** D7: a fix was refused or a session failed — what next. */
export const BUG_HUNTER_D7_MENU = [
  'retry_fix',
  'escalate_model',
  'ask_human',
  'close',
] as const;
export type D7Pick = (typeof BUG_HUNTER_D7_MENU)[number];

/** D8: a verified fix — merge it, or hand it to a person. */
export const BUG_HUNTER_D8_MENU = ['merge', 'ask_human'] as const;
export type D8Pick = (typeof BUG_HUNTER_D8_MENU)[number];

/**
 * D6's menu: the engines and models a fix session may run on. Gemini only,
 * since Claude left the platform on 2026-10-08; the strong tier is where a
 * retry after a refusal or a failure goes.
 */
export const BUG_HUNTER_FIX_MODEL_MENU: {
  engine: BugHunterEngine;
  model: string;
  tier: 'fast' | 'strong';
}[] = [
  { engine: 'gemini', model: 'gemini-2.5-flash', tier: 'fast' },
  { engine: 'gemini', model: 'gemini-2.5-pro', tier: 'strong' },
  { engine: 'opencode', model: 'gemini-2.5-pro', tier: 'strong' },
];

/** D6's pick, stored on `bug_findings.metadata.fixPlan` and read by the fix workflow's models call. */
export interface FixPlan {
  engine: BugHunterEngine;
  model: string;
  tier: 'fast' | 'strong';
  /** One sentence from the model on how to approach the fix; null when the rule picked. */
  approach: string | null;
  /** 1 for the first session on this bug, counting up on every retry. */
  attempt: number;
  decisionId: string | null;
  plannedAt: string;
}

/** Why the orchestrator sent a session back in — rendered into the fix brief. Stored on `metadata.retry`. */
export interface FixRetry {
  kind: 'verifier_fail' | 'session_failed' | 'conflict';
  /** The D7 pick that caused it. */
  move: 'retry_fix' | 'escalate_model';
  attempt: number;
  /** The Verifier's named failures, for a `verifier_fail`. */
  failures: string[];
  /** The refused PR to continue on, for a `verifier_fail`. */
  prUrl: string | null;
  decisionId: string | null;
  at: string;
}

/** Running totals the orchestrator keeps on `metadata.orchestrator`. */
export interface OrchestratorState {
  retries: number;
  lastMove: BugHunterMove | null;
  lastMoveAt: string | null;
}

/** The orchestrator's running state on a finding, defaulting to nothing done. */
export function orchestratorStateOf(finding: {
  metadata?: Record<string, any> | null;
}): OrchestratorState {
  const s = finding.metadata?.orchestrator as
    | Partial<OrchestratorState>
    | undefined;
  return {
    retries: Number(s?.retries ?? 0) || 0,
    lastMove: (s?.lastMove as BugHunterMove | undefined) ?? null,
    lastMoveAt: s?.lastMoveAt ?? null,
  };
}

/** A budget or safety veto: the rule acts on `pick`, the model is not asked. */
export interface OrchestratorVeto {
  by: 'budget' | 'safety' | 'mode';
  reason: string;
}

export type DecisionOwner = 'rule' | 'model';

/** Who owns each point when no admin has said otherwise. */
export const BUG_HUNTER_DECISION_OWNER_DEFAULTS: Record<
  DecisionPoint,
  DecisionOwner
> = {
  D1: 'model',
  D2: 'model',
  D3: 'model',
  D4: 'rule',
  D5: 'model',
  D6: 'model',
  D7: 'rule',
  D8: 'rule',
};

/** Points no setting can hand to a model: the vendor rule and the merge gate. */
export const BUG_HUNTER_DECISION_POINTS_FIXED: readonly DecisionPoint[] = [
  'D4',
  'D8',
];

export const BUG_HUNTER_DECISION_POINT_QUESTIONS: Record<
  DecisionPoint,
  string
> = {
  D1: 'senses',
  D2: 'model',
  D3: 'triage',
  D4: 'verifier',
  D5: 'fix_now',
  D6: 'approach',
  D7: 'next_move',
  D8: 'merge',
};

/** The orchestrator's 5-minute look at open fix PRs: conflicts and stale branches (OPP-0758). */
export const BUG_HUNT_PR_RECONCILE_TASK = 'bug-hunter-open-pr-reconcile';

/** How many refusals or failures the orchestrator will act on before it insists on a person. */
export const BUG_HUNTER_D7_MAX_AUTOMATIC_RETRIES = 2;

/** The replay flips a point's owner when the shadow has beaten the owner this many times. */
export const BUG_HUNTER_REPLAY_FLIP_THRESHOLD = 30;
