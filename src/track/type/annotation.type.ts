/**
 * ANNOTATED_ARTIFACT ("Annotation") component types.
 *
 * The learner is shown a real artifact — a call transcript, chat log or case
 * note — pre-split into numbered units, and marks units with author-defined
 * labels. Grading is exact set comparison against the author's key, which is
 * why the artifact is segmented at author time rather than free-selected:
 * a tap on a unit is unambiguous, works on mobile, and needs no fuzzy span
 * matching.
 */

export enum AnnotationArtifactKind {
  /** Lines of `Speaker: text`, one unit per speaker turn. */
  TRANSCRIPT = 'TRANSCRIPT',
  /** Prose split on blank lines, one unit per paragraph. */
  DOCUMENT = 'DOCUMENT',
}

/**
 * When the learner sees the full answer key (misses + the author's notes).
 * Mirrors the shape of QuizShowExplanations. Revealing everything after every
 * attempt makes attempt two a copying exercise, so the default withholds
 * misses until the learner has passed or run out of attempts.
 */
export enum AnnotationRevealKey {
  AFTER_EACH_ATTEMPT = 'after_each_attempt',
  AFTER_PASS_OR_LAST_ATTEMPT = 'after_pass_or_last_attempt',
}

/**
 * Fixed palette. Labels are always rendered with a swatch AND a distinct
 * marked-state treatment, never colour alone — the eight names here map to
 * accessible token pairs in the frontend.
 */
export enum AnnotationSwatch {
  AMBER = 'amber',
  TEAL = 'teal',
  VIOLET = 'violet',
  ROSE = 'rose',
  BLUE = 'blue',
  GREEN = 'green',
  ORANGE = 'orange',
  SLATE = 'slate',
}

export interface AnnotationUnit {
  id: string;
  /** TRANSCRIPT only; omitted for DOCUMENT paragraphs. */
  speaker?: string;
  text: string;
}

export interface AnnotationLabel {
  id: string;
  /** What the learner picks, e.g. "Missed risk cue". */
  text: string;
  /** Optional expansion shown on hover / long-press. */
  description?: string;
  color: AnnotationSwatch;
}

/** One (unit, label) pair the author expects the learner to find. */
export interface AnnotationTarget {
  unitId: string;
  labelId: string;
  /** Defaults to 1. */
  points?: number;
  /** The teaching moment, shown on reveal. This is the point of the reveal. */
  note?: string;
}

export interface AnnotationSettings {
  /** Percent (0-100) required to pass; mirrored to completionCriteria.passScore. */
  passScore: number;
  /** null / undefined = unlimited attempts. */
  maxAttempts?: number | null;
  /**
   * Points deducted per mark that isn't a target. Without a penalty, marking
   * every unit with every label scores 100%; with it, that strategy scores 0.
   * Authors may set 0 for a low-stakes practice run.
   */
  falsePositivePenalty: number;
  revealKey: AnnotationRevealKey;
}

export interface AnnotationContent {
  kind: AnnotationArtifactKind;
  /** Framing shown above the artifact, e.g. "Where does the caller minimise?" */
  intro?: string;
  units: AnnotationUnit[];
  labels: AnnotationLabel[];
  targets: AnnotationTarget[];
  settings: AnnotationSettings;
}

/** What the learner submits: one entry per (unit, label) they marked. */
export interface AnnotationMark {
  unitId: string;
  labelId: string;
}

export enum AnnotationVerdict {
  /** A target the learner marked. */
  FOUND = 'FOUND',
  /** A target the learner did not mark. Withheld until the key is revealed. */
  MISSED = 'MISSED',
  /** A mark that isn't a target. Costs falsePositivePenalty. */
  NOT_HERE = 'NOT_HERE',
}

export interface AnnotationGradingEntry {
  unitId: string;
  labelId: string;
  verdict: AnnotationVerdict;
  /** Signed: +points for FOUND, -penalty for NOT_HERE, 0 for MISSED. */
  points: number;
  /** The author's note. Only ever populated once the key is revealed. */
  note?: string;
}

export interface AnnotationGrading {
  entries: AnnotationGradingEntry[];
  found: number;
  missed: number;
  notHere: number;
  /** Clamped at 0 — a heavily penalised attempt scores zero, never negative. */
  pointsAwarded: number;
  pointsPossible: number;
}

export function targetPoints(target: AnnotationTarget): number {
  return target.points && target.points > 0 ? target.points : 1;
}

/** Stable key for a (unit, label) pair, used for set comparison throughout. */
export function markKey(unitId: string, labelId: string): string {
  return `${unitId} ${labelId}`;
}
