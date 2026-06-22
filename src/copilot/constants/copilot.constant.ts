import { CopilotRunStatus } from '../enum/copilot-run.enum';

/**
 * Composite score (0-100, the mean of the per-metric LLM-judge scores) at or
 * above which the auto-built actor is considered good enough and the run
 * succeeds. Below it, the run refines and tries again.
 */
export const COPILOT_SCORE_THRESHOLD = 90;

/** Maximum number of generate -> converse -> evaluate rounds before failing. */
export const COPILOT_MAX_ROUNDS = 5;

/**
 * Hard cap on the persisted activity feed length (safety valve). With 5 rounds
 * x ~8 fields x 2 events + tier/score markers a run realistically stays well
 * under this; when exceeded, the oldest non-anchor events are dropped first
 * (never round_scored / terminal / revise_requested markers).
 */
export const COPILOT_PROGRESS_LOG_MAX = 500;

/** Max length of a progress event label / reason (truncated at the writer). */
export const COPILOT_PROGRESS_LABEL_MAX = 120;
export const COPILOT_PROGRESS_REASON_MAX = 200;

/**
 * Maximum number of counselor (agent B) turns in the practice conversation.
 * Maps directly to the scenario-report `turns` parameter.
 */
export const COPILOT_MAX_TURNS = 20;

/** Statuses from which a run can no longer transition. */
export const COPILOT_END_STATUSES: CopilotRunStatus[] = [
  CopilotRunStatus.SUCCEEDED,
  CopilotRunStatus.FAILED,
  CopilotRunStatus.CANCELLED,
];

/**
 * Default practice language for the auto-built draft. English (India) is the
 * canonical English row in the languages table (see ScenarioSharedService).
 */
export const COPILOT_DEFAULT_LANGUAGE_VALUE = 'en-IN';

/** Redis watchdog key prefix + TTL — mirrors the scenario-report pattern. */
export const COPILOT_RUN_REDIS_KEY_PREFIX = 'copilot-run';
export const COPILOT_RUN_TIMEOUT_MINUTES = 30;
export const COPILOT_RUN_TTL_SECONDS = COPILOT_RUN_TIMEOUT_MINUTES * 60;

/**
 * Counselor (agent B) brief for the practice conversation: a trainee
 * mental-health worker practicing core counseling skills against the
 * roleplay actor. Sent as the scenario-report `prompt` (the report harness's
 * counselor template injects it). Kept deliberately generic so it exercises
 * the actor across competencies; the evaluator judges the ACTOR, not this
 * counselor.
 */
export const COPILOT_COUNSELOR_BRIEF = `You are a mental health support worker in training, practicing a one-to-one conversation with a client. This is a practice session whose purpose is to exercise the client's behaviour, not to be graded yourself.

Conduct yourself as a competent trainee would:
- Open warmly and build rapport before probing.
- Use open-ended questions, reflective listening, and brief summaries.
- Show empathy and validate the client's feelings; avoid lecturing or rushing to solutions.
- Gently explore the client's situation, feelings, and needs over the conversation.
- Keep each of your turns short and natural — usually 1 to 3 sentences.
- Stay in role as the worker for the whole conversation; never break character or describe what you are doing.`;
