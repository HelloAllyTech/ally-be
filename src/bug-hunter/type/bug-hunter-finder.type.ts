import { BugHunterEngine } from './bug-hunter-model-settings.type';

/**
 * The Finder stage — OPP-0781.
 *
 * Discovery used to be a fixed checklist inside the nightly sweep: five
 * finders, every repo, one engine, every night, filed straight to people.
 * The Finder makes three of those choices decisions, made by a model over
 * the scoreboard with the rule's pick logged beside it:
 *
 *   D1  which senses to run on this repo for this trigger
 *   D2  which engine and model to run them on
 *   D3  for each new unproven finding: send it to the independent verifier,
 *       hold it for a person, or drop it as noise
 *
 * A sense is one way of looking. The five below are what the sweep already
 * does; the catalogue is the menu D1 picks from, and a new sense (locale
 * parity, a browser) is a new entry here plus a finder section in the brief.
 */
export const BUG_HUNTER_SENSES = [
  'tests',
  'code_review',
  'production_log',
  'browser_errors',
  'reported_bugs',
] as const;
export type BugHunterSense = (typeof BUG_HUNTER_SENSES)[number];

export const BUG_HUNTER_SENSE_DESCRIPTIONS: Record<BugHunterSense, string> = {
  tests:
    'run the repo’s test, lint and type commands; a failure is a proven bug',
  code_review: 'read the recent diff as a careful reviewer',
  production_log: 'read the last 24h of CloudWatch errors for the repo',
  browser_errors: 'read the last 24h of PostHog client exceptions for the repo',
  reported_bugs: 'read the human bug reports filed against the repo',
};

/** What started a Finder run. `scheduled` is the nightly cron; the rest are event triggers. */
export type FinderTriggerKind = 'scheduled' | 'manual' | 'merge' | 'report';

/**
 * The engines and models the Finder may run on: Gemini only. Claude Code
 * was on the menu until 2026-10-08, when Claude left the platform after
 * Bug Hunter drained the Anthropic credits. The rule's default is always
 * the platform setting, which is Gemini.
 */
export const BUG_HUNTER_FINDER_MODEL_MENU: {
  engine: BugHunterEngine;
  model: string;
  tier: 'fast' | 'strong';
}[] = [
  { engine: 'gemini', model: 'gemini-2.5-flash', tier: 'fast' },
  { engine: 'gemini', model: 'gemini-2.5-pro', tier: 'strong' },
  { engine: 'opencode', model: 'gemini-2.5-pro', tier: 'strong' },
];

/** D3's menu. */
export const BUG_HUNTER_TRIAGE_MENU = ['verify', 'hold', 'drop'] as const;
export type BugHunterTriage = (typeof BUG_HUNTER_TRIAGE_MENU)[number];

/** The Finder's plan for one run, stored on `bug_hunt_runs.metadata.finder`. */
export interface FinderPlan {
  trigger: FinderTriggerKind;
  /** A light pass reads less and is capped shorter: merges and reports, not the nightly. */
  light: boolean;
  senses: BugHunterSense[];
  model: { engine: BugHunterEngine; model: string };
  /** Decision row ids for D1 and D2, so the run's timeline can link them. */
  decisions: { D1: string | null; D2: string | null };
  plannedAt: string;
}

/** The sense a finding's `source` came from. Browser errors file as production_log. */
export function senseOfSource(source: string): BugHunterSense | null {
  switch (source) {
    case 'test_failure':
    case 'lint_error':
      return 'tests';
    case 'code_review':
      return 'code_review';
    case 'production_log':
      return 'production_log';
    case 'reported_bug':
      return 'reported_bugs';
    default:
      return null;
  }
}
