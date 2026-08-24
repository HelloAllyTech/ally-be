import { ErrorCode } from './error-code.enum';

/**
 * Single home for the user-facing wording of the failures this repo raises
 * deliberately.
 *
 * TODO(i18n): every string in this file is English-only. ally-be has no i18n
 * layer for exception messages — `src/dynamic-i18n` translates CONTENT
 * (scenarios, templates, prompts), not platform errors — so these are emitted
 * verbatim regardless of the caller's locale. They are collected here so that
 * adding a locale later is one change in one file plus a lookup, rather than a
 * hunt through every throw site. Do NOT hand-translate them ad hoc at the call
 * site: a half-translated error surface is worse than a consistently English
 * one, because the client cannot tell which strings it may safely display.
 *
 * Rules for anything added here:
 *  - Say what failed and what the reader can do about it. "Database query
 *    failed" is a fine thing to log and a useless thing to read.
 *  - Never name an internal detail — no env var names, table names, constraint
 *    names, hostnames, or driver text. Those go to the logger.
 *  - Keep the string stable-ish, but treat the paired `ErrorCode` as the real
 *    contract: clients branch on the code, humans read the message.
 */
export const FAILURE_MESSAGES = {
  // ── Generic ───────────────────────────────────────────────────────────────
  /**
   * Returned for any `QueryFailedError`. Deliberately says nothing about the
   * statement: the raw driver string names columns, constraints and tables, and
   * used to be sent straight to the client.
   */
  DATABASE_ERROR: 'Something went wrong on our side. Please try again.',
  /**
   * A missing/blank deployment setting. The specific setting is logged, never
   * returned — naming it tells an attacker exactly which knob is unset.
   */
  CONFIGURATION_ERROR:
    'This feature is not fully configured yet. Please contact support.',

  // ── Authentication / authorization ────────────────────────────────────────
  UNAUTHENTICATED: 'Please sign in to continue.',

  // ── Downstream AI services ────────────────────────────────────────────────
  AI_UNAVAILABLE:
    'The AI service is temporarily unavailable. Please try again in a moment.',
  AI_TIMEOUT: 'The AI service took too long to respond. Please try again.',
  AI_THROTTLED:
    'The AI service is busy right now. Please wait a moment and try again.',
  AI_REJECTED:
    'The AI service could not process this request. Please contact support if it keeps happening.',
} as const;

/**
 * The user-facing sentence a WhatsApp worker or admin sees for a required
 * permission/role/feature they do not hold.
 *
 * These NAME what was required, which is the whole point of the change that
 * introduced them: a bare "Forbidden resource" tells a developer nothing, and
 * the required permission was sitting in scope unused. A permission key is not
 * sensitive — it is already visible in the admin UI's role editor — whereas the
 * fact that a specific *user* lacks it is what stays in the log.
 */
export const AUTHZ_MESSAGES = {
  missingPermissions: (permissions: string[], operator: 'AND' | 'OR'): string =>
    permissions.length === 1
      ? `Missing required permission: ${permissions[0]}`
      : `Missing required permissions (${operator}): ${permissions.join(', ')}`,
  missingRoles: (roles: string[]): string =>
    roles.length === 0
      ? // An empty @Roles() list. Unreachable from any current call site, but it
        // denies rather than opening the route, so it still needs wording that
        // does not read as an empty sentence.
        'This route is not available to any role as currently configured.'
      : roles.length === 1
        ? `Missing required role: ${roles[0]}`
        : `Requires one of these roles: ${roles.join(', ')}`,
  missingFeature: (featureKey: string): string =>
    `Missing required feature access: ${featureKey}`,
} as const;

/**
 * Human wording for an ally-ai/ally-ai-learn failure, keyed by the code that
 * classified it. Kept next to the codes so a new code cannot ship without
 * someone deciding what a user should read.
 */
export function messageForAiErrorCode(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.AI_SERVICE_TIMEOUT:
      return FAILURE_MESSAGES.AI_TIMEOUT;
    case ErrorCode.AI_SERVICE_THROTTLED:
      return FAILURE_MESSAGES.AI_THROTTLED;
    case ErrorCode.AI_REQUEST_REJECTED:
      return FAILURE_MESSAGES.AI_REJECTED;
    default:
      return FAILURE_MESSAGES.AI_UNAVAILABLE;
  }
}
