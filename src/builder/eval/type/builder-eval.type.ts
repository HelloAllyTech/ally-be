import { BuilderPrdDocument } from '../../type/builder-prd.type';

/**
 * Shapes for Builder's replay eval.
 *
 * A fixture is a recorded interview the eval can play again: what the admin
 * opened with, what they actually said, and a checklist a person wrote once
 * saying what a correct PRD contains. A run plays the fixture through the real
 * interview loop in a sandbox, with a simulated admin answering from that
 * record, and scores what happened.
 *
 * Fixtures hold production admin text and the repos are public, so they live
 * in the database, never in a file in the repo.
 */

/** `interview` replays a session; `prd_review` checks the critic on one PRD. */
export type BuilderEvalFixtureKind = 'interview' | 'prd_review';

/** One line of ground truth a correct PRD must (or must not) satisfy. */
export interface BuilderEvalChecklistItem {
  /** "C1", "C2"… — what the simulated admin and the judge cite. */
  id: string;
  /** In plain words, e.g. "Reuses Auto-improve rather than a new challenger job". */
  text: string;
  /** `must`: the PRD says this. `must_not`: the PRD must not say or plan this. */
  kind: 'must' | 'must_not';
}

export interface BuilderEvalInterviewPayload {
  /** The admin's first message, verbatim. */
  openingMessage: string;
  /** The hand-off brief a roadmap opportunity carried in, when there was one. */
  handoffContext?: string | null;
  /**
   * Everything the admin said after the opening, in order — the simulated
   * admin prefers these words when one of them answers what is asked.
   */
  adminScript: string[];
  /** What a correct PRD contains. Written by a person; empty until they do. */
  checklist: BuilderEvalChecklistItem[];
  /** The PRD the recorded session ended with, for reference — never scored. */
  recordedPrd?: BuilderPrdDocument | null;
  /**
   * The repo commits the session ran against. File reads in the replay are
   * pinned to these; code search cannot be pinned (GitHub only indexes the
   * default branch), so a replay can find code newer than the session did.
   */
  pins?: Record<string, string>;
  /** Turns before the replay gives up. Default BUILDER_EVAL_MAX_TURNS. */
  maxTurns?: number;
}

export interface BuilderEvalPrdReviewPayload {
  /** The PRD under review — a seeded defect, or a clean control. */
  prd: BuilderPrdDocument;
  /** What the session read, as the evidence log records it (`repo:path`). */
  evidence?: { readOk: string[]; readFailed: string[] };
  /** The transcript the reviewer reads: ADMIN / BUILDER lines. */
  transcript?: { role: 'admin' | 'builder'; text: string }[];
  /**
   * What the critic should do. `blocking: true` — a seeded defect, which some
   * readiness row or review finding must block on; `category` narrows which.
   * `blocking: false` — a clean control, where nothing may block.
   */
  expect: {
    blocking: boolean;
    /** A review category or readiness row key the block must come from. */
    via?: string;
  };
}

export type BuilderEvalPayload =
  | BuilderEvalInterviewPayload
  | BuilderEvalPrdReviewPayload;

/**
 * Candidate changes a run plays with instead of what is live: prompt text by
 * prompt code, and the interviewer's model settings. Applied only inside the
 * sandbox — nothing live reads them.
 */
export interface BuilderEvalOverrides {
  prompts?: Record<string, string>;
  /**
   * Which interview loop the replay runs: validated turns or the loop before
   * them. Stamped on every suite when it starts (from the live setting unless
   * given), so a suite records which loop it measured and a prompt-gate
   * baseline is only ever one that ran the same loop. Absent on suites from
   * before the setting existed, which all ran the legacy loop.
   */
  validatedTurns?: boolean;
  /**
   * Whether the replay runs the interview protocol (builder_settings.situationBrief):
   * a discovery sweep and a situation brief before the first question, then the
   * question gate. Stamped like `validatedTurns`; absent on suites from before
   * it existed, which ran without it. Only has an effect with validated turns.
   */
  situationBrief?: boolean;
  /** Model settings by prompt code, as the prompt row would hold them. */
  llmConfig?: Record<
    string,
    {
      provider?: string | null;
      model?: string | null;
      temperature?: number | null;
    }
  >;
}

/**
 * The deterministic checks. Each counts how often a failure the interview has
 * really shipped happened in the run; a passing run has every count at zero
 * and every boolean true. They gate, the judge only scores — a model grading a
 * model is the part that can drift, so it is never the part that decides.
 */
export interface BuilderEvalGates {
  /**
   * Tool calls that failed in the same batch as the question that ended the
   * turn — failures the reply was written without seeing. Session 2bc3a5cf
   * had six.
   */
  unseenFailures: number;
  /** Batches that asked the admin while research results were still unread. */
  askedBeforeReading: number;
  /** PRD edits that failed with no successful edit after them in that turn. */
  unrepairedEditFailures: number;
  /** Turns whose prose claims a PRD change while no edit succeeded. */
  falseUpdateClaims: number;
  /** The final PRD's cross-section checks (test plan, requirement homes, mobile). */
  consistent: boolean;
  /** What already exists rests on files the replay actually read. */
  evidenceCited: boolean;
}

export interface BuilderEvalMetrics {
  /** The interview loop the run replayed; absent on runs from before it was recorded. */
  loop?: 'validated' | 'legacy';
  /** The interview protocol ran (builder_settings.situationBrief); absent before it existed. */
  protocol?: boolean;
  /** A situation brief was shown. */
  briefDelivered?: boolean;
  /**
   * The brief came before the first question — the protocol's promise that
   * what exists is named before anything is asked. False with no brief.
   */
  briefBeforeFirstQuestion?: boolean;
  /** Lines in the brief. */
  briefLines?: number;
  /** Brief lines the simulated admin corrected. Each correcting reply also counts in `corrections`. */
  briefCorrections?: number;
  turns: number;
  /** ask_admin calls. */
  questions: number;
  /** Simulated-admin replies that corrected Builder. */
  corrections: number;
  /** Which checklist items each correction was about. */
  correctedItems: string[];
  readyReached: boolean;
  /** The readiness score of the final PRD. */
  readinessScore: number;
  toolCalls: number;
  toolFailures: number;
  /** Estimated from token counts and the pricing table. */
  costUsd: number;
  durationMs: number;
}

export interface BuilderEvalJudgement {
  /** Checklist items the final PRD satisfies. */
  met: number;
  total: number;
  /** met / total, 0..1; 1 when the checklist is empty. */
  score: number;
  items: { id: string; met: boolean; evidence: string }[];
  model?: string | null;
  error?: string | null;
}

/** For a `prd_review` fixture: what the critic did with the PRD. */
export interface BuilderEvalCriticOutcome {
  /** Readiness rows that blocked, by key. */
  blockingRows: string[];
  /** Review findings, by category. */
  findings: { id: string; category: string; detail: string }[];
  /** Whether the outcome matched the fixture's expectation. */
  asExpected: boolean;
}

/** A frame from the replay's transcript, kept for reading a failed run. */
export interface BuilderEvalTurnRecord {
  turn: number;
  admin: string;
  /** True when the simulated admin was correcting Builder. */
  correction?: boolean;
  builder: string;
  question?: string | null;
  /** The situation brief this turn showed, one line each: `X1 exists: …`. */
  brief?: string[];
  toolCalls: { name: string; ok: boolean; summary?: string }[];
}

export type BuilderEvalRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'errored'
  /** Never run: its suite was cancelled first. */
  | 'cancelled';

export type BuilderEvalSuiteStatus =
  | 'running'
  | 'completed'
  | 'errored'
  /** Stopped by a person; runs that had finished keep their results. */
  | 'cancelled';

export type BuilderEvalSuiteTrigger = 'manual' | 'baseline' | 'prompt_gate';

/** The suite's roll-up, one row per fixture plus the totals a gate compares. */
export interface BuilderEvalSuiteSummary {
  fixtures: {
    fixtureId: string;
    name: string;
    kind: BuilderEvalFixtureKind;
    runs: number;
    passed: number;
    /** Sums over the fixture's runs, for comparison with a baseline. */
    gateViolations: number;
    corrections: number;
    judgeScore: number | null;
  }[];
  runs: number;
  passed: number;
  errored: number;
  gateViolations: number;
  corrections: number;
  /** Mean judge score over interview runs that were judged. */
  judgeScore: number | null;
  costUsd: number;
}

/** What a prompt-gate suite decided, and against what. */
export interface BuilderEvalVerdict {
  pass: boolean;
  /** Why, in a sentence per comparison that failed — or that it held. */
  reasons: string[];
  baselineSuiteId: string | null;
}

/** What a prompt-gate suite was asked to publish if it passes. */
export interface BuilderEvalPromptCandidate {
  promptCode: string;
  /** New prompt text; absent when only the model settings change. */
  content?: string | null;
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
}
