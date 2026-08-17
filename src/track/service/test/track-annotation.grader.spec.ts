import {
  annotationScorePct,
  gradeAnnotation,
} from '../track-annotation.grader';
import {
  shouldRevealKey,
  buildAnnotationAttemptView,
  sanitizeAnnotationForLearner,
} from '../track-annotation.sanitizer';
import {
  AnnotationArtifactKind,
  AnnotationContent,
  AnnotationRevealKey,
  AnnotationSwatch,
  AnnotationVerdict,
} from '../../type/annotation.type';
import { TrackAnnotationAttempt } from '../../entity/track-annotation-attempt.entity';

const content: AnnotationContent = {
  kind: AnnotationArtifactKind.TRANSCRIPT,
  intro: 'Where does the caller minimise?',
  units: [
    { id: 'u1', speaker: 'Caller', text: "I don't know why I called." },
    { id: 'u2', speaker: 'Caller', text: "It's not a big deal." },
    { id: 'u3', speaker: 'Volunteer', text: "What's been happening?" },
    { id: 'u4', speaker: 'Caller', text: "I'm fine. Sorry, this is stupid." },
  ],
  labels: [
    { id: 'l1', text: 'Minimising', color: AnnotationSwatch.AMBER },
    { id: 'l2', text: 'Closed question', color: AnnotationSwatch.TEAL },
  ],
  targets: [
    { unitId: 'u2', labelId: 'l1', note: 'Classic minimising move.' },
    { unitId: 'u4', labelId: 'l1', note: 'Apologising for calling.' },
  ],
  settings: {
    passScore: 70,
    maxAttempts: 2,
    falsePositivePenalty: 1,
    revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
  },
};

describe('gradeAnnotation', () => {
  it('scores a perfect set of marks at 100%', () => {
    const grading = gradeAnnotation(content, [
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u4', labelId: 'l1' },
    ]);
    expect(grading.found).toBe(2);
    expect(grading.missed).toBe(0);
    expect(grading.notHere).toBe(0);
    expect(annotationScorePct(grading)).toBe(100);
  });

  it('counts a target the learner did not mark as a miss worth nothing', () => {
    const grading = gradeAnnotation(content, [{ unitId: 'u2', labelId: 'l1' }]);
    expect(grading.found).toBe(1);
    expect(grading.missed).toBe(1);
    expect(grading.pointsAwarded).toBe(1);
    expect(annotationScorePct(grading)).toBe(50);
  });

  it('penalises a mark that is not a target', () => {
    const grading = gradeAnnotation(content, [
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u4', labelId: 'l1' },
      { unitId: 'u3', labelId: 'l1' },
    ]);
    expect(grading.found).toBe(2);
    expect(grading.notHere).toBe(1);
    expect(grading.pointsAwarded).toBe(1);
    expect(annotationScorePct(grading)).toBe(50);
  });

  it('scores shotgunning every line with every label at zero', () => {
    const everything = content.units.flatMap((unit) =>
      content.labels.map((label) => ({
        unitId: unit.id,
        labelId: label.id,
      })),
    );
    const grading = gradeAnnotation(content, everything);
    expect(grading.found).toBe(2);
    expect(grading.notHere).toBe(6);
    // 2 found - 6 penalties = -4, clamped to 0 rather than going negative.
    expect(grading.pointsAwarded).toBe(0);
    expect(annotationScorePct(grading)).toBe(0);
  });

  it('collapses duplicate marks so they are neither double-scored nor double-penalised', () => {
    const dupeHit = gradeAnnotation(content, [
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u4', labelId: 'l1' },
    ]);
    expect(dupeHit.found).toBe(2);
    expect(annotationScorePct(dupeHit)).toBe(100);

    const dupeMiss = gradeAnnotation(content, [
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u4', labelId: 'l1' },
      { unitId: 'u3', labelId: 'l2' },
      { unitId: 'u3', labelId: 'l2' },
    ]);
    expect(dupeMiss.notHere).toBe(1);
  });

  it('honours per-target points', () => {
    const weighted: AnnotationContent = {
      ...content,
      targets: [
        { unitId: 'u2', labelId: 'l1', points: 3 },
        { unitId: 'u4', labelId: 'l1', points: 1 },
      ],
    };
    const grading = gradeAnnotation(weighted, [
      { unitId: 'u2', labelId: 'l1' },
    ]);
    expect(grading.pointsPossible).toBe(4);
    expect(grading.pointsAwarded).toBe(3);
    expect(annotationScorePct(grading)).toBe(75);
  });

  it('applies no penalty when the author set it to zero', () => {
    const lenient: AnnotationContent = {
      ...content,
      settings: { ...content.settings, falsePositivePenalty: 0 },
    };
    const grading = gradeAnnotation(lenient, [
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u4', labelId: 'l1' },
      { unitId: 'u1', labelId: 'l2' },
    ]);
    expect(grading.notHere).toBe(1);
    expect(annotationScorePct(grading)).toBe(100);
  });
});

describe('shouldRevealKey', () => {
  const base = {
    revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
    passed: false,
    attemptsUsed: 1,
    maxAttempts: 2,
  };

  it('withholds the key after a failed non-final attempt', () => {
    expect(shouldRevealKey(base)).toBe(false);
  });

  it('reveals once the learner passes', () => {
    expect(shouldRevealKey({ ...base, passed: true })).toBe(true);
  });

  it('reveals once attempts are exhausted', () => {
    expect(shouldRevealKey({ ...base, attemptsUsed: 2 })).toBe(true);
  });

  it('never reveals on a failed attempt when attempts are unlimited', () => {
    expect(
      shouldRevealKey({ ...base, maxAttempts: null, attemptsUsed: 99 }),
    ).toBe(false);
  });

  it('always reveals when the author chose after_each_attempt', () => {
    expect(
      shouldRevealKey({
        ...base,
        revealKey: AnnotationRevealKey.AFTER_EACH_ATTEMPT,
      }),
    ).toBe(true);
  });
});

describe('sanitizeAnnotationForLearner', () => {
  it('never ships the answer key', () => {
    const learner = sanitizeAnnotationForLearner(content);
    expect(learner).not.toHaveProperty('targets');
    expect(JSON.stringify(learner)).not.toContain('Classic minimising move');
  });

  it('does ship the scoring rule so the learner can aim at it', () => {
    const learner = sanitizeAnnotationForLearner(content);
    expect(learner.settings.passScore).toBe(70);
    expect(learner.settings.falsePositivePenalty).toBe(1);
  });

  it('keeps the units in document order', () => {
    const learner = sanitizeAnnotationForLearner(content);
    expect(learner.units.map((unit) => unit.id)).toEqual([
      'u1',
      'u2',
      'u3',
      'u4',
    ]);
  });
});

describe('buildAnnotationAttemptView', () => {
  const attemptFrom = (marks: { unitId: string; labelId: string }[]) => {
    const grading = gradeAnnotation(content, marks);
    const scorePct = annotationScorePct(grading);
    return {
      id: 'a1',
      attemptNumber: 1,
      marks,
      grading,
      scorePct,
      passed: scorePct >= content.settings.passScore,
    } as TrackAnnotationAttempt;
  };

  it('withholds misses, notes and the target count while unrevealed', () => {
    const attempt = attemptFrom([
      { unitId: 'u2', labelId: 'l1' },
      { unitId: 'u3', labelId: 'l2' },
    ]);
    const view = buildAnnotationAttemptView(attempt, content, 1);

    expect(view.revealed).toBe(false);
    expect(view.missed).toBeUndefined();
    expect(view.pointsPossible).toBeUndefined();
    expect(
      view.entries.some((e) => e.verdict === AnnotationVerdict.MISSED),
    ).toBe(false);
    expect(view.entries.every((e) => e.note === undefined)).toBe(true);
    // The learner's own marks are still scored back to them.
    expect(view.entries.map((e) => e.verdict).sort()).toEqual([
      AnnotationVerdict.FOUND,
      AnnotationVerdict.NOT_HERE,
    ]);
  });

  it('reveals misses and the author notes once attempts are exhausted', () => {
    const attempt = attemptFrom([{ unitId: 'u2', labelId: 'l1' }]);
    const view = buildAnnotationAttemptView(attempt, content, 2);

    expect(view.revealed).toBe(true);
    expect(view.missed).toBe(1);
    expect(view.pointsPossible).toBe(2);
    const missedEntry = view.entries.find(
      (e) => e.verdict === AnnotationVerdict.MISSED,
    );
    expect(missedEntry?.unitId).toBe('u4');
    expect(missedEntry?.note).toBe('Apologising for calling.');
  });
});
