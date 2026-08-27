import { UxSignalDetector } from '../enum/ux-signal.enum';

/**
 * Prompt code resolved through PromptSharedService (folder file, or a dashboard
 * override once an admin edits it). Convention: `<subdir>_<filename>` — this one
 * is src/prompts/ux_signals/triage.txt.
 */
export const UX_SIGNAL_PROMPT_CODES = {
  TRIAGE: 'ux_signals_triage',
} as const;

/** Anthropic call shape for the one triage call per scan. */
export const UX_SIGNAL_LLM = {
  MAX_TOKENS: 4000,
  /** Bounded like the suggestions call: a scheduled task must not hang forever. */
  TIMEOUT_MS: 120_000,
} as const;

/**
 * Per-scan caps on what may be filed.
 *
 * Caps, not targets — the prompt is explicit that fewer is better than padded.
 * These exist so one noisy night cannot flood either inbox: both destinations
 * are human review queues, and a queue nobody can read is the same as no queue.
 */
export const UX_SIGNAL_LIMITS = {
  MAX_BUGS_PER_SCAN: 10,
  MAX_SUGGESTIONS_PER_SCAN: 10,
  /** Signals handed to triage. Detectors are ranked by severity before slicing. */
  MAX_SIGNALS_PER_SCAN: 40,
  /** Sample rows kept per signal, for the model and for the finding's evidence. */
  EXAMPLES_PER_SIGNAL: 5,
} as const;

/** Field caps applied to triage output before it is stored. */
export const UX_SIGNAL_FIELD_LIMITS = {
  TITLE: 200,
  /** Matches the roadmap description limit, so an accepted card can always be filed. */
  BODY: 1000,
  DESCRIPTION: 4000,
  RATIONALE: 1000,
  EVIDENCE_ITEMS: 8,
  EVIDENCE_ITEM: 300,
} as const;

/**
 * How much prior history goes into the triage prompt as "do not re-propose this".
 *
 * Mirrors SUGGESTION_CONTEXT_LIMITS and exists for the same reason: without it a
 * scan re-proposes what a human already rejected, every single night.
 */
export const UX_SIGNAL_CONTEXT_LIMITS = {
  OPEN_FINDINGS: 100,
  PENDING_SUGGESTIONS: 100,
  REJECTED_SUGGESTIONS: 100,
  EXCERPT: 200,
} as const;

/** The telemetry window every scan reads. */
export const UX_SIGNAL_WINDOW_DAYS = 7;

/**
 * Cadence and overlap guards.
 *
 * The scheduler registry offers 5min/15min/30min/hourly/monthly and no daily
 * tick, so the hourly tick self-gates on this interval instead. A scan is a
 * read-plus-one-LLM-call, and UX trends do not move hour to hour — daily keeps
 * both review queues at a rate a human can actually work through.
 */
export const UX_SIGNAL_SCHEDULE = {
  MIN_HOURS_BETWEEN_SCANS: 24,
  /**
   * A RUNNING row older than this is treated as abandoned (a crash or a redeploy
   * mid-scan), so one dead row cannot wedge the scan forever. Comfortably above
   * the LLM timeout plus every detector query.
   */
  STALE_RUNNING_MINUTES: 15,
} as const;

/**
 * The repo UX findings are attributed to.
 *
 * Set directly rather than left to BugHunterRepoClassifierService: every event a
 * detector reads is emitted by the helpline frontend, so the repo is known from
 * the source of the data, and an LLM guess could only be wrong. A finding with
 * no resolvable repo cannot start a fix session at all.
 */
export const UX_SIGNAL_REPO = 'ally-web';

/**
 * Detector thresholds.
 *
 * ⚠️ These are initial estimates, chosen to err quiet — a scan that files one
 * real bug is useful, a scan that files nine speculative ones trains people to
 * ignore the queue. They are deliberately plain constants: revisit them against
 * real scan output before reaching for runtime configuration, which is only
 * worth building once someone actually needs to tune without a deploy.
 *
 * Every threshold pairs a *volume* floor with a *breadth* floor (sessions or
 * users). Volume alone lets one determined user's bad afternoon look like a
 * platform problem.
 */
export const UX_SIGNAL_THRESHOLDS: Record<
  UxSignalDetector,
  Record<string, number>
> = {
  [UxSignalDetector.API_ERROR_SPIKE]: {
    MIN_EVENTS: 10,
    MIN_SESSIONS: 3,
    /** Multiple of the endpoint's own trailing daily mean. */
    BASELINE_MULTIPLE: 2,
    /** Applied instead when the endpoint has no prior errors at all. */
    MIN_EVENTS_NO_BASELINE: 5,
  },
  [UxSignalDetector.ERROR_LOOP]: {
    /** Same-endpoint errors within one session to count as a loop. */
    MIN_REPEATS_IN_SESSION: 3,
    WITHIN_MINUTES: 5,
    MIN_SESSIONS: 3,
  },
  [UxSignalDetector.RAGE_CLICK_CLUSTER]: {
    MIN_SESSIONS: 3,
    MIN_EVENTS: 5,
  },
  [UxSignalDetector.DEAD_CLICK_CLUSTER]: {
    MIN_EVENTS: 5,
    MIN_SESSIONS: 3,
  },
  [UxSignalDetector.ROUTE_ABANDONMENT]: {
    /** Below this the exit-rate percentage is noise, not a trend. */
    MIN_ROUTE_SESSIONS: 50,
    EXIT_RATE_PERCENT: 60,
  },
  [UxSignalDetector.ZERO_RESULT_SEARCH]: {
    MIN_SEARCHES: 10,
    MIN_USERS: 3,
  },
  [UxSignalDetector.FUNNEL_DROPOFF]: {
    MIN_STARTS: 20,
    COMPLETION_RATE_PERCENT: 40,
  },
};

/**
 * Routes where leaving IS the successful end of the task, excluded from the
 * abandonment detector.
 *
 * Without this the detector's top finding is permanently "users leave after
 * finishing a call", which is the product working. Matched as path prefixes.
 */
export const UX_SIGNAL_TERMINAL_ROUTES = [
  '/post-call-summary',
  '/post-simulation-summary',
  '/login',
  '/logout',
  '/auth',
  '/privacy',
  '/terms',
  '/health',
] as const;

/**
 * Start → completion event pairs for the funnel detector.
 *
 * Only pairs whose events are actually captured produce signals; the rest sit
 * dormant until their events are wired, which is why an unwired pair is a
 * no-signal case and never an error.
 */
export const UX_SIGNAL_FUNNELS = [
  { label: 'Call', start: 'call_started', complete: 'call_ended' },
  {
    label: 'Simulation',
    start: 'simulation_started',
    complete: 'simulation_completed',
  },
  {
    label: 'Learning pathway',
    start: 'pathway_started',
    complete: 'learn_module_opened',
  },
] as const;
