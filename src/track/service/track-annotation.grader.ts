import {
  AnnotationContent,
  AnnotationGrading,
  AnnotationGradingEntry,
  AnnotationMark,
  AnnotationVerdict,
  markKey,
  targetPoints,
} from '../type/annotation.type';

/**
 * Pure grader for an annotation attempt. Set comparison between the learner's
 * marks and the author's targets:
 *
 *   found   — a target the learner marked        → +points
 *   missed  — a target the learner didn't mark   →  0
 *   notHere — a mark that isn't a target         → -falsePositivePenalty
 *
 *   score% = clamp(awarded, 0, possible) / possible * 100
 *
 * The penalty term is what stops "mark everything with every label" scoring
 * 100%. Awarded is clamped at 0 so a heavily penalised attempt reads as zero
 * rather than a negative number nobody can interpret.
 *
 * Duplicate marks are collapsed before grading — a client that sends the same
 * (unit, label) twice must not be penalised twice.
 */
export function gradeAnnotation(
  content: AnnotationContent,
  marks: AnnotationMark[],
): AnnotationGrading {
  const penalty = Math.max(0, content.settings.falsePositivePenalty ?? 0);

  // Collapse duplicates while keeping the mark objects — never round-trip ids
  // back out of the composite key.
  const uniqueMarks = new Map<string, AnnotationMark>();
  for (const mark of marks) {
    uniqueMarks.set(markKey(mark.unitId, mark.labelId), mark);
  }
  const markedKeys = new Set(uniqueMarks.keys());
  const targetKeys = new Set(
    content.targets.map((target) => markKey(target.unitId, target.labelId)),
  );

  const entries: AnnotationGradingEntry[] = [];
  let pointsAwarded = 0;
  let pointsPossible = 0;
  let found = 0;
  let missed = 0;
  let notHere = 0;

  // Targets first, in the author's order — this is the order the reveal reads in.
  for (const target of content.targets) {
    const points = targetPoints(target);
    pointsPossible += points;
    const hit = markedKeys.has(markKey(target.unitId, target.labelId));
    if (hit) {
      found++;
      pointsAwarded += points;
    } else {
      missed++;
    }
    entries.push({
      unitId: target.unitId,
      labelId: target.labelId,
      verdict: hit ? AnnotationVerdict.FOUND : AnnotationVerdict.MISSED,
      points: hit ? points : 0,
      ...(target.note ? { note: target.note } : {}),
    });
  }

  // Then everything the learner marked that isn't a target.
  for (const [key, mark] of uniqueMarks) {
    if (targetKeys.has(key)) continue;
    notHere++;
    pointsAwarded -= penalty;
    entries.push({
      unitId: mark.unitId,
      labelId: mark.labelId,
      verdict: AnnotationVerdict.NOT_HERE,
      points: -penalty,
    });
  }

  return {
    entries,
    found,
    missed,
    notHere,
    pointsAwarded: Math.max(0, pointsAwarded),
    pointsPossible,
  };
}

/** Percent score for a graded attempt. No targets (blocked at publish) → 0. */
export function annotationScorePct(grading: AnnotationGrading): number {
  if (grading.pointsPossible <= 0) return 0;
  const capped = Math.min(grading.pointsAwarded, grading.pointsPossible);
  return Math.round((capped / grading.pointsPossible) * 100);
}
