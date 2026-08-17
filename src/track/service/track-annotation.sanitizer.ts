import {
  AnnotationArtifactKind,
  AnnotationContent,
  AnnotationGrading,
  AnnotationLabel,
  AnnotationRevealKey,
  AnnotationUnit,
  AnnotationVerdict,
  markKey,
} from '../type/annotation.type';
import { TrackAnnotationAttempt } from '../entity/track-annotation-attempt.entity';

export interface LearnerAnnotation {
  kind: AnnotationArtifactKind;
  intro?: string;
  units: AnnotationUnit[];
  labels: AnnotationLabel[];
  settings: {
    passScore: number;
    maxAttempts: number | null;
    falsePositivePenalty: number;
    revealKey: AnnotationRevealKey;
  };
}

/**
 * Strip the answer key. `targets` never leaves the server before the reveal —
 * and the target COUNT is withheld too: publishing it turns the exercise into
 * hunt-until-the-counter-fills, which is not the skill being assessed.
 *
 * `falsePositivePenalty` and `passScore` ARE sent: the learner is told the
 * scoring rule up front so they can aim at it, which is the transparency half
 * of the same decision.
 *
 * Unlike the quiz sanitizer there is no shuffling — the units are a document,
 * and reordering them would destroy the thing being read.
 */
export function sanitizeAnnotationForLearner(
  content: AnnotationContent,
): LearnerAnnotation {
  const settings = content.settings;
  return {
    kind: content.kind,
    ...(content.intro ? { intro: content.intro } : {}),
    units: content.units,
    labels: content.labels,
    settings: {
      passScore: settings.passScore,
      maxAttempts: settings.maxAttempts ?? null,
      falsePositivePenalty: settings.falsePositivePenalty ?? 0,
      revealKey:
        settings.revealKey ?? AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
    },
  };
}

/**
 * Whether this attempt's result may carry the full key (misses + author
 * notes). AFTER_EACH_ATTEMPT always reveals; the default reveals once the
 * learner has passed or spent their last attempt. With unlimited attempts the
 * default only reveals on a pass — which is the intended pressure: keep
 * looking rather than being handed the answer.
 */
export function shouldRevealKey({
  revealKey,
  passed,
  attemptsUsed,
  maxAttempts,
}: {
  revealKey: AnnotationRevealKey;
  passed: boolean;
  attemptsUsed: number;
  maxAttempts: number | null;
}): boolean {
  if (revealKey === AnnotationRevealKey.AFTER_EACH_ATTEMPT) return true;
  if (passed) return true;
  return maxAttempts !== null && attemptsUsed >= maxAttempts;
}

export interface AnnotationResultEntry {
  unitId: string;
  labelId: string;
  verdict: AnnotationVerdict;
  points: number;
  note?: string;
}

/** Everything about a graded attempt except progression, which is the caller's. */
export interface AnnotationAttemptView {
  attemptId: string;
  attemptNumber: number;
  scorePct: number;
  passed: boolean;
  passScore: number;
  attemptsUsed: number;
  maxAttempts: number | null;
  /** Whether the full key (misses + author notes) is included below. */
  revealed: boolean;
  found: number;
  notHere: number;
  /**
   * Only present when revealed. Withheld otherwise because found + missed is
   * the target count, and publishing that turns the next attempt into
   * hunt-until-the-counter-fills. (A learner can still derive it from the
   * score afterwards — the point is that nothing leaks before they've tried.)
   */
  missed?: number;
  pointsAwarded?: number;
  pointsPossible?: number;
  entries: AnnotationResultEntry[];
}

const EMPTY_GRADING: AnnotationGrading = {
  entries: [],
  found: 0,
  missed: 0,
  notHere: 0,
  pointsAwarded: 0,
  pointsPossible: 0,
};

/**
 * Shape a stored attempt for the learner, applying reveal gating. Pure, so
 * both the annotation service (after a submit) and the enrollment service
 * (re-opening a finished component) can call it without a circular import.
 */
export function buildAnnotationAttemptView(
  attempt: TrackAnnotationAttempt,
  content: AnnotationContent,
  attemptsUsed: number,
): AnnotationAttemptView {
  const maxAttempts = content.settings.maxAttempts ?? null;
  const passed = attempt.passed ?? false;
  const revealed = shouldRevealKey({
    revealKey:
      content.settings.revealKey ??
      AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
    passed,
    attemptsUsed,
    maxAttempts,
  });

  const grading = attempt.grading ?? EMPTY_GRADING;

  // Unrevealed results carry only the learner's OWN marks, scored. Misses and
  // the author's notes stay server-side.
  const markedKeys = new Set(
    (attempt.marks ?? []).map((mark) => markKey(mark.unitId, mark.labelId)),
  );
  const entries: AnnotationResultEntry[] = grading.entries
    .filter(
      (entry) =>
        revealed || markedKeys.has(markKey(entry.unitId, entry.labelId)),
    )
    .map((entry) => ({
      unitId: entry.unitId,
      labelId: entry.labelId,
      verdict: entry.verdict,
      points: entry.points,
      ...(revealed && entry.note ? { note: entry.note } : {}),
    }));

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    scorePct: attempt.scorePct !== undefined ? Number(attempt.scorePct) : 0,
    passed,
    passScore: content.settings.passScore,
    attemptsUsed,
    maxAttempts,
    revealed,
    found: grading.found,
    notHere: grading.notHere,
    ...(revealed
      ? {
          missed: grading.missed,
          pointsAwarded: grading.pointsAwarded,
          pointsPossible: grading.pointsPossible,
        }
      : {}),
    entries,
  };
}
