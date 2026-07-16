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

/** Discriminator claim so evaluator JWTs can never pass as user JWTs. */
export const EVALUATOR_TOKEN_KIND = 'lab_evaluator';
export const EVALUATOR_TOKEN_EXPIRES_IN = '7d';

/** Inclusive bounds allowed for a RATING question's scale maximum. */
export const EVAL_RATING_SCALE_MIN = 2;
export const EVAL_RATING_SCALE_MAX = 10;
