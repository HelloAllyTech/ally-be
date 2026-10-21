/**
 * BUCKET_SORT ("Bucket sort") component types.
 *
 * The learner is handed a pile of items and a few labelled buckets and drops
 * each item into the bucket they think it belongs in. The moment they place
 * one, they are told whether it was right — and, if it wasn't, which bucket it
 * actually belongs in and why. The point is to surface a misconception while
 * it is still the learner's own guess, ideally *before* the course teaches
 * over it, which is why it is feedback-first and never gates anything.
 *
 * It is deliberately not a quiz question. A quiz submits every answer at once
 * with the key stripped, which is the opposite of what makes this useful. Here
 * the key stays on the server and is revealed one item at a time, as each is
 * placed (see `TrackBucketSortService`).
 *
 * What is recorded is the learner's FIRST placement of each item: that is the
 * guess that exposes the misconception. After feedback the item is settled in
 * its correct bucket, so a second look is never a copy of the answer. The
 * component completes once every item has been placed, whatever the score.
 */

export interface BucketSortBucket {
  id: string;
  /** The category name shown on the bucket, e.g. "Active listening". */
  label: string;
  /** Optional one-liner that says what belongs here. */
  description?: string;
}

export interface BucketSortItem {
  id: string;
  /** The thing to sort, e.g. "Repeating back what the client just said". */
  text: string;
  /** The bucket this item belongs in. Server-only until the item is placed. */
  bucketId: string;
  /**
   * Why it belongs there. Shown after the learner places the item, right or
   * wrong, so the teaching lands on the right answer as well as the wrong one.
   */
  explanation?: string;
}

export interface BucketSortContent {
  /** Optional framing shown above the buckets. Translatable. */
  intro?: string;
  buckets: BucketSortBucket[];
  items: BucketSortItem[];
}

/** One placed item, as stored on the learner's progress row. */
export interface BucketSortAnswer {
  /** The bucket the learner chose on their first try. */
  bucketId: string;
  correct: boolean;
}
