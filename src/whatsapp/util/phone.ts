/**
 * One definition of "the same phone number", shared by every path that compares two.
 *
 * A profile stores whatever its owner typed — `+91 98765 43210`, `919876543210` and
 * `9876543210` are all the same handset and all appear in real data — while WhatsApp always
 * delivers E.164 without the `+`. Something has to reconcile those, and the moment two places
 * reconcile them slightly differently, a number resolves on one path and not the other: an
 * admin sees a mapping in the table and the bot still refuses the worker.
 */

/**
 * The number of trailing digits that decide identity.
 *
 * TEN, because that is the length of a national mobile number in India and most of the region
 * Ally operates in, so comparing the last ten is what makes the three formats above match.
 *
 * A deliberate floor, not a maximum: fewer digits starts matching different people (an
 * eight-digit suffix collides across a large user base), and requiring the whole string would
 * mean only numbers typed in exactly WhatsApp's shape ever resolve — in practice almost none.
 *
 * The accepted cost is that two genuinely different international numbers sharing their last ten
 * digits are treated as one. Every path applies the SAME rule, so that shows up as a refused or
 * duplicate mapping an admin can see, rather than as one path disagreeing with another.
 */
export const PHONE_MATCH_DIGITS = 10;

/** Digits only. Both sides of every comparison go through this first. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * The comparison key: the last {@link PHONE_MATCH_DIGITS} digits, or '' when there are too few.
 *
 * An empty key means "not identifiable" and must never be stored or matched on — a short number
 * would otherwise become a key that matches every other short number.
 */
export function phoneKey(value: string | null | undefined): string {
  const digits = phoneDigits(value);
  return digits.length < PHONE_MATCH_DIGITS
    ? ''
    : digits.slice(-PHONE_MATCH_DIGITS);
}

/**
 * Do two numbers refer to the same handset?
 *
 * Keys match AND one full number is a tail of the other: `919876543210` and `9876543210` are the
 * same phone, `449876543210` and `919876543210` are not, even though both end in the same ten
 * digits. The key alone is what the database can index; this is the check that then rejects the
 * near-miss.
 */
export function isSamePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (
    left.length < PHONE_MATCH_DIGITS ||
    right.length < PHONE_MATCH_DIGITS ||
    phoneKey(left) !== phoneKey(right)
  ) {
    return false;
  }
  return left.endsWith(right) || right.endsWith(left);
}
