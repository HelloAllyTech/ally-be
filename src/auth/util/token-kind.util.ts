/**
 * `kind` values a platform access token may carry. None today:
 * AuthService.generateTokens signs `{ sub, username, tenantId }`, and every
 * token already on a user's device was signed the same way. Add a value here
 * only in the change that makes AuthService sign it.
 */
const PLATFORM_TOKEN_KINDS: ReadonlySet<unknown> = new Set<string>();

/**
 * Whether a verified access-secret JWT may be treated as a platform session.
 *
 * Other token types mark themselves with a `kind` claim (AI Lab evaluator
 * tokens carry `kind: 'lab_evaluator'`), so a `kind` platform auth does not
 * issue means the token was minted for something else and must not open a
 * platform route, whatever key it verified under.
 *
 * A missing `kind` passes: that is what a normal platform token looks like,
 * and rejecting it would sign every user out.
 */
export function isPlatformTokenKind(
  payload: { kind?: unknown } | null | undefined,
): boolean {
  const kind = payload?.kind;
  return kind === undefined || PLATFORM_TOKEN_KINDS.has(kind);
}
