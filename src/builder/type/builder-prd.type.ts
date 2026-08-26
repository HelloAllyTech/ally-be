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
export interface BuilderPrdAssumption {
  id: string;
  text: string;
  status: 'confirmed' | 'unconfirmed';
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
  /** What is missing, phrased as the next action. Empty when ok. */
  hint: string;
}

export interface BuilderPrdReadiness {
  /** 0-100, whole numbers — the ring in the UI. */
  score: number;
  ready: boolean;
  sections: BuilderPrdReadinessSection[];
  /** Flat list of what still blocks a build; drives the confirm dialog. */
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
