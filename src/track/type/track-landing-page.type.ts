/**
 * The story-led landing page a course can opt into.
 *
 * `TrackLandingPage` is what `tracks.landingPage` stores (always the full
 * normalised shape); `PublicTrackStory` is what the public share link serves
 * once the display rules have been applied. The contract both ends build
 * against is plans/course-landing-story-contract.md.
 */

/** Where a chapter sits on the story's curve. */
export enum StoryBeat {
  SETUP = 'SETUP',
  CONFLICT = 'CONFLICT',
  CHALLENGE = 'CHALLENGE',
  CLIMAX = 'CLIMAX',
  RESOLUTION = 'RESOLUTION',
}

/** How long one sitting takes; shown as a chip, never computed. */
export enum LandingSittingLength {
  /** 5–10 min */
  SHORT = 'SHORT',
  /** 10–15 min */
  MEDIUM = 'MEDIUM',
  /** 15–20 min */
  LONG = 'LONG',
}

export interface LandingReply {
  text: string;
  /** Names what the learner did ("You gave her room"). Never a verdict on the client's outcome. */
  label: string;
  why: string | null;
}

export interface LandingChapter {
  sectionId: string;
  beat: StoryBeat | null;
  teaser: string | null;
}

export interface TrackLandingPage {
  version: 1;
  hero: {
    hook: string | null;
    question: string | null;
    courseLine: string | null;
    buttonLabel: string | null;
  };
  persona: {
    name: string | null;
    descriptor: string | null;
    imageUrl: string | null;
    /** Character Library id, kept for traceability only; the public payload never reads it. */
    characterId: string | null;
  };
  firstMove: {
    enabled: boolean;
    sceneLine: string | null;
    personaLine: string | null;
    prompt: string | null;
    replies: LandingReply[];
  };
  arc: {
    enabled: boolean;
    chapters: LandingChapter[];
    hardCallSectionId: string | null;
  };
  outcomes: { enabled: boolean; items: string[] };
  howItPlays: {
    enabled: boolean;
    sittingLength: LandingSittingLength | null;
  };
  cast: {
    enabled: boolean;
    callerLine: string | null;
    guide: {
      name: string | null;
      role: string | null;
      line: string | null;
    };
  };
  xp: { enabled: boolean };
  contentNotes: { extraNote: string | null };
}

/**
 * Character and count ceilings for every field of the page. Enforced by
 * `TrackLandingPageDto` on a PUT (400), and by truncation in the Course
 * Copilot draft normaliser.
 */
export const TRACK_LANDING_LIMITS = {
  hook: 140,
  question: 100,
  courseLine: 200,
  buttonLabel: 32,
  personaName: 60,
  personaDescriptor: 160,
  personaImageUrl: 2048,
  sceneLine: 80,
  personaLine: 240,
  prompt: 100,
  /** Reply count, then the length of each reply's fields. */
  replies: 4,
  replyText: 200,
  replyLabel: 60,
  replyWhy: 280,
  chapters: 100,
  teaser: 160,
  /** Outcome count, then the length of each. */
  outcomes: 3,
  outcome: 120,
  callerLine: 160,
  guideName: 60,
  guideRole: 60,
  guideLine: 200,
  extraNote: 300,
} as const;

/** The least replies the first-move block needs before it is shown. */
export const LANDING_FIRST_MOVE_MIN_REPLIES = 2;

/**
 * What the public share link serves under `story`. Null unless the course's
 * landing page has a hook (story mode). Every block is already filtered by its
 * display rule, so the client renders what is here and nothing else.
 */
export interface PublicTrackStory {
  hook: string;
  question: string | null;
  courseLine: string | null;
  buttonLabel: string | null;
  persona: {
    name: string;
    descriptor: string | null;
    imageUrl: string | null;
  } | null;
  firstMove: {
    sceneLine: string | null;
    personaLine: string;
    prompt: string | null;
    /** 2–4, each with text and label. */
    replies: { text: string; label: string; why: string | null }[];
  } | null;
  arc: {
    /** One per public section, in order. */
    chapters: {
      sectionId: string;
      beat: StoryBeat | null;
      teaser: string | null;
    }[];
    /** Only when it is one of those sections. */
    hardCallSectionId: string | null;
  } | null;
  outcomes: string[] | null;
  howItPlays: { sittingLength: LandingSittingLength | null } | null;
  cast: {
    caller: {
      name: string;
      line: string | null;
      imageUrl: string | null;
    } | null;
    guide: {
      name: string;
      role: string | null;
      line: string | null;
    } | null;
  } | null;
  /** An upper bound: the daily caps can only lower what a learner earns. */
  xp: { activityXp: number; hasRoleplays: boolean } | null;
  contentNotes: {
    /** Distinct names; chapters are 1-based positions, ascending. */
    warnings: { name: string; chapters: number[] }[];
    extraNote: string | null;
  } | null;
}
