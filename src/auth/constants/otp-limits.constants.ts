import { TIME } from 'src/common/constants/time.constants';

/**
 * Limits on the email login code (`generate-otp` / `verify-otp`).
 *
 * The code is 4 digits, so 9,000 values. With no limits at all, anyone who knows
 * a learner's address could request a code and try every value inside its
 * 5-minute life. Each limit below closes a different way round the others:
 *
 * - Per code: a code checked {@link MAX_GUESSES_PER_CODE} times without a match
 *   is destroyed, together with the sign-in link sent with it.
 * - Per address per day: {@link MAX_GUESSES_PER_DAY} checks with no successful
 *   sign-in, across every code. Requesting fresh codes is otherwise a way to
 *   reset the per-code count, so this is the bound that actually holds against
 *   a patient attacker: about 20 / 9,000 ≈ 0.2% a day. Any successful sign-in
 *   resets it, so it only ever accumulates against someone who never has the
 *   code. The emailed sign-in link is not counted and keeps working, which is
 *   the way back in for a learner caught by it.
 * - Per address: {@link MAX_CODES_PER_WINDOW} codes per
 *   {@link CODE_WINDOW_SECONDS}. Stops one address being flooded with emails.
 *   Checked before the account lookup, so unknown addresses are limited the same
 *   way and the limit reveals nothing about who has an account.
 * - Per client address: {@link PER_IP} on each route, through `@RateLimit`.
 *   Sized for a whole workshop signing in at once from one office or campus
 *   network, so it is a ceiling on one machine sweeping many addresses, not a
 *   brute-force defence — the per-address limits are that.
 *
 * Every per-address key uses the trimmed, lower-cased address, the form
 * accounts are stored in. Keyed on the address as typed, `Learner@x.com` and
 * `learner@x.com` were separate codes with separate counts for one account.
 */
export const OTP_LIMITS = {
  MAX_GUESSES_PER_CODE: 5,
  MAX_GUESSES_PER_DAY: 20,
  GUESS_DAY_SECONDS: TIME.DAY_IN_SECONDS,
  MAX_CODES_PER_WINDOW: 5,
  CODE_WINDOW_SECONDS: 15 * TIME.MINUTE_IN_SECONDS,
  PER_IP: { LIMIT: 100, TTL_MS: 10 * TIME.MINUTE_IN_MS },
} as const;

/**
 * Shown verbatim: the web and mobile login screens both display the response's
 * `message` as the error. Each one says what to do next.
 */
export const OTP_LIMIT_MESSAGES = {
  CODE_LOCKED: 'Too many incorrect codes. Please request a new code.',
  generateRequest: (wait: string) =>
    `Too many codes requested for this email. Please try again in ${wait}.`,
  dailyGuesses: (wait: string) =>
    `Too many incorrect codes. Use the sign-in link in your email, or try again in ${wait}.`,
  IP_GENERATE:
    'Too many code requests from this network. Please try again in a few minutes.',
  IP_VERIFY:
    'Too many sign-in attempts from this network. Please try again in a few minutes.',
} as const;

/** "1 minute", "14 minutes", "3 hours": a wait in the words a message can use. Rounds up. */
export function describeWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / TIME.MINUTE_IN_SECONDS));
  if (minutes < 60) {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}
