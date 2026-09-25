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
  };
}
