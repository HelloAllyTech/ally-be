import * as crypto from 'crypto';

/**
 * PostHog distinct id for a learner we can only identify by email — every event
 * fired before tokens exist.
 *
 * The address itself never leaves the service: HIPAA keeps PII out of
 * everything but the designated audit loggers, so the funnel is keyed on a
 * SHA-256 of the normalised email instead. The digest is stable across an
 * attempt (and across attempts from the same address), which is what lets
 * `auth.started` and `auth.completed` pair up, and `posthog.alias()` folds it
 * into the numeric user id once a login succeeds.
 */
export function emailDistinctId(email: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex');
  return `email:${digest}`;
}

/**
 * Distinct id for an authenticated learner. Kept as the bare user id so events
 * captured here land on the same PostHog person as the client-side ones.
 */
export function userDistinctId(userId: number): string {
  return String(userId);
}

/**
 * Distinct id for an attempt whose learner we never resolved — a Google token
 * that failed verification carries no email. One-shot by design: it keeps the
 * failed attempt countable in the funnel without inventing an identity that
 * later events could wrongly join onto.
 */
export function anonymousDistinctId(): string {
  return `anon:${crypto.randomUUID()}`;
}
