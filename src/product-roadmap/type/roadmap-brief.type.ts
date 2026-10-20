/**
 * The copilot's verdict on how strong an opportunity is, in three words a voter can read.
 *
 * DELIBERATELY NOT A SCORE. Stacks, "Avoid Scoring Formulas When Prioritizing Opportunities":
 * scoring each lens and ranking the totals falsely implies one correct answer and stops people
 * thinking once a number exists. A three-step judgement with its reasons written next to it
 * keeps the reasons as the thing people argue with.
 */
export enum RoadmapBriefRating {
  NEEDS_WORK = 'needs_work',
  PROMISING = 'promising',
  STRONG = 'strong',
}

/**
 * Where a piece of evidence came from. The set mirrors the copilot's research tools plus
 * `admin` — something the filer told it, which is evidence too, just the weakest kind to rest
 * a case on alone.
 */
export enum RoadmapBriefEvidenceSource {
  ADMIN = 'admin',
  ANALYTICS = 'analytics',
  UX_SIGNALS = 'ux_signals',
  BUG_FINDINGS = 'bug_findings',
  USER_INTERVIEWS = 'user_interviews',
  ROADMAP = 'roadmap',
  CODEBASE = 'codebase',
  WIKI = 'wiki',
  STACKS = 'stacks',
  STRATEGY = 'strategy',
}

export interface RoadmapBriefStrategicFit {
  /** A strategy goal name, or a bet named on the Vision & strategy page. */
  goal: string;
  why: string;
}

export interface RoadmapBriefEvidence {
  source: RoadmapBriefEvidenceSource;
  claim: string;
  /** Where to check it: an opportunity code, a file path, a query, an interview title. */
  ref: string | null;
}

export interface RoadmapBriefReach {
  /**
   * How many — and separately how often. Stacks, "Distinguish customer count from frequency in
   * opportunity sizing": one group hitting something constantly is a different case from many
   * hitting it occasionally, and one blended "lots of users" hides which it is.
   */
  howMany: string | null;
  howOften: string | null;
}

export interface RoadmapBriefAssessment {
  rating: RoadmapBriefRating;
  /** One or two sentences: why this rating, in the copilot's words. */
  summary: string;
  /** What would move it up a rating. Empty once the copilot rates it strong. */
  openRecommendations: string[];
}

/**
 * The structured brief the copilot builds alongside the draft, and files with it.
 *
 * The description stays the votable summary; this is the case behind it — why it matters
 * strategically, what says it is real, how we would know it worked, and what has to be true.
 * Stored on `roadmap_opportunities.brief` exactly as signed into the readiness token, so what a
 * voter reads as "the copilot's assessment" is the copilot's, not a filer's edit of it.
 */
export interface RoadmapOpportunityBrief {
  strategicFit: RoadmapBriefStrategicFit[];
  reach: RoadmapBriefReach;
  evidence: RoadmapBriefEvidence[];
  /** A product outcome — a leading indicator the team can move — not feature usage. */
  successMetric: string | null;
  /** The leap-of-faith ones: most important to the case, weakest evidence behind them. */
  assumptions: string[];
  /** What was considered and set aside, so it is not silently lost. */
  alternativesDropped: string[];
  assessment: RoadmapBriefAssessment;
}

/**
 * One message of the conversation that filed an opportunity through the copilot.
 *
 * `agent` is the copilot, `admin` the filer — the same two roles the interview route takes.
 * Kept on the filed row (`roadmap_opportunities.interviewTranscript`) so the work that follows
 * it, today a Builder session, can start where the conversation ended instead of re-asking it.
 */
export interface RoadmapFilingInterviewMessage {
  role: 'admin' | 'agent';
  content: string;
}
