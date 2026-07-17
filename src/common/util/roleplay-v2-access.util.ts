/**
 * Shared Roleplay Studio v2 rollout-gate helpers. Used by BOTH the session-start
 * gate (RoleplaySessionService) and the learner-catalog visibility filter
 * (ScenarioService.getScenariosV2) so "who may use v2" is decided in exactly one
 * place. A v2 session/scenario is available to a user only when the master flag
 * is on AND their email is allowlisted.
 */

export interface RoleplayV2Config {
  enabled: boolean;
  allowlist: string[];
}

/**
 * Canonicalize an email for allowlist matching: lower-case, trim, and drop any
 * `+tag` sub-address. So sandeep.malhotra+admin@… and sandeep.malhotra+learner@…
 * both match the single `sandeep.malhotra@…` allowlist entry — a tester can spin
 * up as many `+tag` accounts as they like without listing each one. (Gmail /
 * Google Workspace route every `+tag` to the same base mailbox.)
 */
export function normalizeEmailForAllowlist(raw?: string | null): string {
  const email = (raw ?? '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes '@'
  const plus = local.indexOf('+');
  const baseLocal = plus === -1 ? local : local.slice(0, plus);
  return `${baseLocal}${domain}`;
}

/**
 * True when this email may use v2: the flag is on AND the (normalized) email is
 * on the (normalized) allowlist. A disabled flag returns false for EVERYONE,
 * allowlisted users included.
 */
export function isRoleplayV2EmailAllowed(
  email: string | null | undefined,
  cfg: RoleplayV2Config | null | undefined,
): boolean {
  if (!cfg?.enabled) return false;
  const normalized = normalizeEmailForAllowlist(email);
  if (!normalized) return false;
  return cfg.allowlist.map(normalizeEmailForAllowlist).includes(normalized);
}
