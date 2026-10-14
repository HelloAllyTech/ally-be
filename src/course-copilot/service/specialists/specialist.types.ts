import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBlueprintSection,
  CourseBrief,
  CourseReviewFinding,
} from '../../type/course-copilot.type';

/**
 * What every content specialist receives.
 *
 * A specialist is ONE `LlmCompletionService.complete({jsonMode:true})` call
 * with a narrow prompt — not an agent loop. It gets only the context it needs:
 * the brief (the shared, cached understanding of the course), the blueprint
 * for position, and its own item. Stacks: "Bind Specialized Tools to Separate
 * Language Models"; "Hierarchical Agent Managers Double Costs Without Quality
 * Gains".
 */
export interface SpecialistContext {
  sessionId: string;
  brief: CourseBrief;
  /** The approved blueprint, or the live one in the edit loop. */
  blueprint: CourseBlueprint;
  section: CourseBlueprintSection;
  item: CourseBlueprintItem;
  /**
   * Set when regenerating an existing item: its current content and what the
   * trainer asked to change. The specialist keeps what was not asked about.
   */
  previous?: { content: Record<string, any>; instructions: string };
  /**
   * Set on the repair pass: the validator's errors from the first attempt.
   * The specialist appends them to its prompt and tries once more.
   */
  repairErrors?: string[];
  /** Merged into every usage row: `{ courseCopilotSessionId, jobId? }`. */
  usageMetadata: Record<string, any>;
}

/** A specialist's validated output, ready to be written as a track item. */
export interface SpecialistOutput {
  /** Item `content`, already passed through `validateTrackItemContent`. */
  content: Record<string, any>;
  /** One line for the build panel and the change log: "8 questions". */
  summary: string;
  /** Article only: a one-sentence brief for an illustrative image. */
  imageBrief?: string;
}

/**
 * Thrown when a model's output cannot be made valid. `errors` are fed back
 * to the same specialist as `repairErrors` on the one repair pass.
 */
export class SpecialistValidationError extends Error {
  constructor(
    public readonly errors: string[],
    message = `Generated content failed validation: ${errors.join('; ')}`,
  ) {
    super(message);
    this.name = 'SpecialistValidationError';
  }
}

/** Implemented by the article, quiz, journal and annotation specialists. */
export interface ItemSpecialist {
  generate(context: SpecialistContext): Promise<SpecialistOutput>;
}

/** Input to the blueprint planner. */
export interface BlueprintPlannerInput {
  sessionId: string;
  brief: CourseBrief;
  /** Optional trainer notes passed to propose_blueprint ("keep it to 3 sections"). */
  notes?: string;
  /** Library roleplays/cases the interview already settled on. */
  libraryPicks: {
    scenarioId?: number;
    caseId?: string;
    title: string;
    competency?: string | null;
    difficulty?: string | null;
  }[];
  /** Game keys available, with one-line descriptions. */
  games: { key: string; description: string }[];
  usageMetadata: Record<string, any>;
}

export interface CourseMetaInput {
  sessionId: string;
  brief: CourseBrief;
  blueprint: CourseBlueprint;
  usageMetadata: Record<string, any>;
}

export interface CourseMetaOutput {
  title: string;
  description: string;
}

export interface CourseReviewInput {
  sessionId: string;
  brief: CourseBrief;
  /** Compact outline JSON plus full content of inline items (article html capped). */
  courseDigest: string;
  usageMetadata: Record<string, any>;
}

export interface ImagePromptInput {
  sessionId: string;
  brief: CourseBrief;
  /** 'cover' for the course cover, 'article' for an in-article illustration. */
  purpose: 'cover' | 'article';
  title: string;
  /** Course description, or the article's imageBrief + excerpt. */
  context: string;
  usageMetadata: Record<string, any>;
}

export type { CourseReviewFinding };
