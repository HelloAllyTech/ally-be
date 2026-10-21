import {
  BucketSortAnswer,
  BucketSortBucket,
  BucketSortContent,
} from '../type/bucket-sort.type';

export interface LearnerBucketSortItem {
  id: string;
  text: string;
}

export interface BucketSortFeedback {
  correct: boolean;
  /** The bucket the learner chose on their first try. */
  placedBucketId: string;
  /** Where the item really belongs; revealed only once the item is placed. */
  correctBucketId: string;
  explanation: string | null;
}

export interface LearnerBucketSort {
  intro?: string;
  buckets: BucketSortBucket[];
  /** Answer key stripped; order is stable per learner/round (see `seed`). */
  items: LearnerBucketSortItem[];
  /** Feedback for items already placed, so a reload resumes where they were. */
  answered: Record<string, BucketSortFeedback>;
}

/** Deterministic string hash → 32-bit seed. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable shuffle: the same seed gives the same order, so a reload never reshuffles. */
function seededShuffle<T>(list: T[], seed: string): T[] {
  let state = hash(seed) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function feedbackFor(
  content: BucketSortContent,
  itemId: string,
  answer: BucketSortAnswer,
): BucketSortFeedback | null {
  const item = content.items.find((i) => i.id === itemId);
  if (!item) return null;
  return {
    correct: answer.correct,
    placedBucketId: answer.bucketId,
    correctBucketId: item.bucketId,
    explanation: item.explanation?.trim() || null,
  };
}

/**
 * Strip the answer key. `bucketId` and `explanation` of an item reach the
 * learner only inside `answered`, after that item has been placed — never for
 * an item still in the pile.
 */
export function sanitizeBucketSortForLearner(
  content: BucketSortContent,
  answers: Record<string, BucketSortAnswer> | undefined,
  seed: string,
): LearnerBucketSort {
  const answered: Record<string, BucketSortFeedback> = {};
  for (const [itemId, answer] of Object.entries(answers ?? {})) {
    const feedback = feedbackFor(content, itemId, answer);
    if (feedback) answered[itemId] = feedback;
  }
  return {
    ...(content.intro ? { intro: content.intro } : {}),
    buckets: content.buckets,
    items: seededShuffle(
      content.items.map(({ id, text }) => ({ id, text })),
      seed,
    ),
    answered,
  };
}
