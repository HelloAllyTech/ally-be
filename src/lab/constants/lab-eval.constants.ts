/** AI Lab human-evaluation constants. */

/**
 * Generated evaluator passwords use unambiguous alphanumerics (no 0/O/1/l/I) so
 * they survive being read out loud / shared offline. Assembled from parts so no
 * single long literal exists — this is a public character alphabet, not a
 * secret, and building it this way avoids secret-scanner false positives.
 */
const PASSWORD_UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_DIGITS = '23456789';
export const EVALUATOR_PASSWORD_CHARSET =
  PASSWORD_UPPERCASE + PASSWORD_LOWERCASE + PASSWORD_DIGITS;
export const EVALUATOR_PASSWORD_LENGTH = 14;

/** bcrypt cost factor — matches the platform convention (user.service). */
export const EVALUATOR_PASSWORD_SALT_ROUNDS = 10;

/**
 * Discriminator claim on evaluator JWTs. Platform auth (JwtStrategy and the
 * WebSocket middleware) refuses any token carrying a `kind` it does not issue,
 * so this claim is the second lock; the signing key below is the first.
 */
export const EVALUATOR_TOKEN_KIND = 'lab_evaluator';
export const EVALUATOR_TOKEN_EXPIRES_IN = '7d';

/**
 * Domain-separation label for the evaluator signing key, which is
 * HMAC-SHA256(JWT_ACCESS_SECRET, label) — derived rather than a new env var,
 * as with the helpline guest and roadmap readiness keys, so it ships as code.
 *
 * Evaluator tokens used to be signed with the access secret itself, so the
 * only thing keeping them off platform routes was a `kind` claim that
 * platform auth never read. Under a derived key the platform verifiers cannot
 * check an evaluator token's signature at all, and the evaluator guard cannot
 * check a platform token's.
 *
 * Bump the version suffix to sign every evaluator out at once.
 */
export const EVALUATOR_TOKEN_KEY_LABEL = 'lab-evaluator-token-v1';

/** Inclusive bounds allowed for a RATING question's scale maximum. */
export const EVAL_RATING_SCALE_MIN = 2;
export const EVAL_RATING_SCALE_MAX = 10;
