/**
 * The PRD document schema.
 *
 * One document serves two very different readers, which is why it carries
 * both stakeholder-facing prose and a developer-facing technical plan: a
 * human decides from it whether to press "Start build", and the coding agent
 * implements from it verbatim. A section that reads well but leaves the
 * implementer guessing has failed half its job.
 *
 * Every prose field is markdown. The shape is stable because the admin UI
 * renders and edits it section by section, and RFC-6902 patches address it by
 * JSON Pointer — renaming a key breaks both.
 */

export interface BuilderPrdRequirement {
  /** Short stable id ("R1"); referenced by the build plan and PR bodies. */
  id: string;
  title: string;
  description: string;
  /** Observable, testable conditions. The agent turns these into tests. */
  acceptanceCriteria: string[];
}

/**
 * Something the agent inferred rather than being told. Unconfirmed
 * assumptions block readiness on purpose: an unexamined inference is exactly
 * the thing that produces a technically-complete build of the wrong feature.
 */
/**
 * What backs an assumption the interview marked confirmed.
 *
 * `status: 'confirmed'` used to be a bare claim — confirmed by what, nobody
 * could say. Now that the interview can consult production numbers, CloudWatch
 * and Bug Hunter's findings, "confirmed" can mean something checkable, and the
 * check belongs beside the claim rather than in a log.
 *
 * It sits in the PRD deliberately, not in an audit table. The raw calls are
 * already persisted on `builder_messages.toolCalls`; what was missing was the
 * link from a specific claim to the specific lookup that settled it, in the
 * document a human reviews. A reviewer seeing "used by 412 sessions" with no
 * provenance has to take it on trust; seeing it dated and attributed, they can
 * tell a measured fact from a plausible-sounding one — and tell when it went
 * stale, which is the failure this really guards against.
 */
export interface BuilderPrdEvidence {
  /** The tool that produced it — analytics_ask, prod_errors, bug_findings_search… */
  source: string;
  /** The finding, in one line, as the agent read it. */
  detail: string;
  /** When it was looked up. A number true in March may not be true in September. */
  at: string;
}

export interface BuilderPrdAssumption {
  id: string;
  text: string;
  status: 'confirmed' | 'unconfirmed';
  /**
   * Present when a lookup settled this, absent when a human simply asserted
   * it. Both are legitimate — an admin saying "we have decided to support
   * this" is not weaker evidence, it is a different kind — so an absent value
   * means "not measured", never "unverified".
   */
  evidence?: BuilderPrdEvidence;
}

export interface BuilderPrdRepoPlan {
  repo: string;
  /** What changes in this repo, in enough detail to start from. */
  changesMd: string;
}

export interface BuilderPrdTechnicalPlan {
  repos: BuilderPrdRepoPlan[];
  dataModelMd: string;
  apiMd: string;
}

/**
 * The technical design: how the PRD will be built, written with the code in
 * front of it.
 *
 * Exists because the PRD's own `technicalPlan` is written by the in-process
 * interviewer, which has code search but no checkout — and on 2026-10-12
 * (session 880e73e6) that plan renamed a persisted JSON key with a migration
 * and broke every released mobile client that read it. The technical plan is
 * now a sketch; this is the document the build is held to, drafted by a
 * read-only designer run on the runner with every target repo cloned, checked
 * by a cold critic, and approved by a person.
 *
 * Stored on the PRD document rather than in its own table so it is versioned
 * with the PRD it was designed from, by the same version trail. It is not the
 * interviewer's to write: `update_prd` and the admin PATCH both refuse any op
 * under `/technicalDesign`.
 */
export type BuilderTechnicalDesignStatus =
  | 'drafting'
  | 'review'
  | 'approved'
  | 'failed';

export interface BuilderDesignScope {
  repo: string;
  /**
   * Repo-relative paths or globs the build may change. Becomes the build's
   * hard scope check, so a file missing here is a file the build cannot touch.
   */
  files: string[];
}

/** One stored field, API field, enum or table the change touches. */
export interface BuilderDesignContract {
  name: string;
  change: string;
  /** Every place that reads it, as "repo:path:line". */
  readers: string[];
}

export interface BuilderDesignTest {
  requirementId: string;
  repo: string;
  file: string;
  asserts: string;
}

export interface BuilderDesignReview {
  /**
   * 'concerns' exactly when `defects` is non-empty. Derived, not chosen, so a
   * reviewer that files only scope suggestions cannot mark a sound design as
   * failing — the first critic on session 880e73e6 flagged "trainers cannot
   * author rich text in article questions", which the PRD never asked for.
   */
  verdict: 'pass' | 'concerns';
  notesMd: string;
  /** What would make the build wrong or a released client break. */
  defects?: string[];
  /** Scope the design could widen to; a person's call, not a failure. */
  suggestions?: string[];
  at: string;
}

export type BuilderPreviousDesign = Pick<
  BuilderTechnicalDesign,
  | 'designMd'
  | 'scope'
  | 'contracts'
  | 'compatibilityMd'
  | 'testMap'
  | 'openDecisions'
  | 'review'
>;

export interface BuilderTechnicalDesign {
  status: BuilderTechnicalDesignStatus;
  /** The DESIGN run drafting it; only that run may submit to it. */
  runId: string | null;
  designMd: string;
  scope: BuilderDesignScope[];
  contracts: BuilderDesignContract[];
  compatibilityMd: string;
  testMap: BuilderDesignTest[];
  /** Anything the PRD did not decide. Each one blocks approval. */
  openDecisions: string[];
  review: BuilderDesignReview | null;
  /**
   * `productHashOf` of the PRD it was designed from. A PRD edited after the
   * design was drafted no longer matches, and the design is stale.
   */
  productHash: string;
  draftedAt: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  error: string | null;
  /**
   * The draft this one replaces, with its reviewer's findings — what a
   * redraft is asked to fix. Without it a redraft started from nothing and
   * could repeat exactly what the critic objected to (session 880e73e6's
   * first design missed the component-template save path and two mobile
   * readers; the critic found all three). Never nested: a redraft of a
   * redraft carries only its immediate predecessor.
   */
  previous?: BuilderPreviousDesign | null;
}

/** Progress flags the interviewer sets as it completes each phase. */
export interface BuilderPrdUiState {
  interview?: Record<string, boolean>;
}

export interface BuilderPrdDocument {
  title: string;
  summary: string;
  problem: string;
  usersAndContext: string;
  /**
   * What the platform already does in this area, written before any
   * requirement is.
   *
   * The interview has code search, repo knowledge packs and the wiki, and it
   * still specified an already-shipped feature — a column, its CHECK
   * constraint, its enum, the picker, the label map and the accuracy panel —
   * after searching the codebase twice. Searching is not the failure; the
   * failure is that finding nothing reads as proof nothing is there, and
   * nowhere in the document was it obliged to say what it found.
   *
   * So this is a section rather than a line in the prompt: the rubric can
   * block on it, and a requirement that duplicates what this paragraph
   * describes is visibly contradictory rather than merely unlucky. It also
   * reaches the coder, which matters most — a build told what exists starts
   * from the real codebase instead of an imagined empty one.
   */
  existingBehaviour: string;
  /**
   * Which repo owns each change, and why that layer rather than the one where
   * the problem was noticed.
   *
   * Symptom and cause are not the same place, and the repo an admin was
   * looking at when they filed the request is evidence about neither. ally-web
   * #713 was raised against a notification badge that would not clear, scoped
   * to ally-web because that is where the badge is; the defect was an ally-be
   * query matching zero rows. Builder could only edit what it was given, so it
   * localised a server bug to the client, wrote a test asserting the client
   * behaviour it had changed, and passed every gate with the feature still
   * broken.
   *
   * A section rather than a line in the prompt, for the same reason
   * `existingBehaviour` is one: the rubric can block on it. And because it
   * names repos explicitly, the rubric can do something a prompt cannot —
   * check that every repo named here actually appears in the technical plan.
   * A build that has traced the behaviour to ally-be cannot then quietly plan
   * only ally-web.
   */
  whereChangesBelong: string;
  goals: string;
  nonGoals: string;
  requirements: BuilderPrdRequirement[];
  assumptions: BuilderPrdAssumption[];
  technicalPlan: BuilderPrdTechnicalPlan;
  testPlanMd: string;
  e2ePlanMd: string;
  /** Questions the agent could not resolve; each one blocks readiness. */
  openQuestions: string[];
  ui?: BuilderPrdUiState;
  /** Null until an admin drafts one. See BuilderTechnicalDesign. */
  technicalDesign?: BuilderTechnicalDesign | null;
}

/** One row of the readiness rubric shown beside the document. */
export interface BuilderPrdReadinessSection {
  key: string;
  label: string;
  ok: boolean;
  /**
   * What is missing, phrased as the next action, in one short sentence.
   * Empty when ok. This is what the admin sees, in a tooltip.
   */
  hint: string;
  /**
   * The same gap spelled out for the interview agent: which JSON Pointers to
   * patch, the declared field names, the legal values. Kept apart from `hint`
   * because the two readers want different lengths — the agent cannot see the
   * schema and needs all of it, while a paragraph of pointers in the admin's
   * tooltip is just noise. Empty when ok, and absent where there is nothing
   * mechanical to add.
   */
  detail?: string;
}

export interface BuilderPrdReadiness {
  /** 0-100, whole numbers — the ring in the UI. */
  score: number;
  ready: boolean;
  sections: BuilderPrdReadinessSection[];
  /**
   * Flat list of what still blocks a build: `hint` plus `detail`, so the
   * agent gets the actionable half. The UI counts these rather than reading
   * them; the text a human sees comes from `sections[].hint`.
   */
  blockers: string[];
  /**
   * The cold reviewer's record, when this readiness was assessed with it —
   * findings, their status and any dismissals. Null before the first review.
   */
  review?: BuilderPrdReview | null;
}

/**
 * What the cold reviewer can object to. The five ways a PRD that passes every
 * structural check can still send a build the wrong way — each one seen in
 * session 2bc3a5cf, whose v8 read ready while doing all five.
 */
export type BuilderPrdReviewCategory =
  | 'contradiction'
  | 'unsupported_claim'
  | 'unapplied_correction'
  | 'missed_reuse'
  | 'missing_success_metric';

export const BUILDER_PRD_REVIEW_CATEGORIES: BuilderPrdReviewCategory[] = [
  'contradiction',
  'unsupported_claim',
  'unapplied_correction',
  'missed_reuse',
  'missing_success_metric',
];

/** A person's decision that a finding is wrong, kept as eval data. */
export interface BuilderPrdReviewDismissal {
  reason: string;
  /** The admin who dismissed it — directly, or through the interview quoting them. */
  by: number;
  at: string;
  /** `admin` from the PRD panel; `interview` when the agent recorded the admin's words. */
  via: 'admin' | 'interview';
}

export interface BuilderPrdReviewFinding {
  /** "F1", "F2"… stable for the life of the review. */
  id: string;
  category: BuilderPrdReviewCategory;
  /** The PRD key it is about — `requirements`, `technicalPlan`, `existingBehaviour`… */
  section: string;
  /** What is wrong, in a sentence or two. */
  detail: string;
  /** What would resolve it. */
  fix: string;
  /** The words in the PRD or transcript it rests on, when there are some. */
  quote?: string;
  status: 'open' | 'fixed' | 'dismissed';
  /** PRD version the reviewer read. */
  raisedInVersion: number;
  /** PRD version a recheck found it resolved in. */
  fixedInVersion?: number;
  /** The recheck's one line on why it now reads resolved — or still open. */
  checkNote?: string;
  dismissal?: BuilderPrdReviewDismissal;
}

/**
 * The cold reviewer's record on a PRD: run once, when the document first reads
 * ready, then rechecked against its own open findings as the PRD changes.
 *
 * Stored on the doc row (`builder_prd_docs.review`), not in the draft: a
 * dismissal is not a PRD edit and should not cut a version, and nothing an
 * `update_prd` patch does can reach it.
 */
export interface BuilderPrdReview {
  /**
   * `done` — the reviewer answered (possibly with no findings).
   * `failed` — the call itself failed; the next write retries it, and in the
   * meantime it does not block. A crashed reviewer says nothing about the PRD.
   */
  status: 'done' | 'failed';
  /** PRD version the full review read. */
  versionNumber: number;
  /** PRD version the open findings were last checked against. */
  checkedVersion: number;
  model: string | null;
  reviewedAt: string;
  checkedAt: string;
  findings: BuilderPrdReviewFinding[];
  error?: string | null;
  /** Failed attempts in a row; reset by a success. */
  failures?: number;
}

/**
 * Facts about the session the readiness rubric cannot read off the draft.
 *
 * Gathered by `BuilderReadinessService`. Every field is optional and a field
 * left undefined skips the check that needs it — so a caller that has none of
 * them (a unit test, the pure rubric) gets the structural rubric unchanged,
 * and a deployment with no catalog yet is not blocked for want of one.
 */
export interface BuilderReadinessSignals {
  /** Learner components on both web and mobile, by name. */
  parityTwins?: { name: string; web: string; mobile: string }[];
  /** What the session's evidence log shows was read. */
  evidence?: {
    /** Rows in the log at all — zero means a session from before the log. */
    total: number;
    /** `repo:path` of every successful read. */
    readOk: string[];
    /** `repo:path` of every failed read. */
    readFailed: string[];
  };
  /**
   * The admin's latest message that said something in their own words, and
   * when the PRD last changed. `null` message: none to check.
   */
  lastAdminMessage?: { text: string; at: Date } | null;
  lastPrdEditAt?: Date | null;
  /** `null`: not reviewed yet. Undefined: not part of this assessment. */
  review?: BuilderPrdReview | null;
}

/** A fresh, empty PRD. Every key present so RFC-6902 `replace` always resolves. */
export function createEmptyPrdDocument(
  title = 'Untitled build',
): BuilderPrdDocument {
  return {
    title,
    summary: '',
    problem: '',
    usersAndContext: '',
    existingBehaviour: '',
    whereChangesBelong: '',
    goals: '',
    nonGoals: '',
    requirements: [],
    assumptions: [],
    technicalPlan: { repos: [], dataModelMd: '', apiMd: '' },
    testPlanMd: '',
    e2ePlanMd: '',
    openQuestions: [],
    ui: { interview: {} },
    technicalDesign: null,
  };
}
