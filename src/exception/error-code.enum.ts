/**
 * Stable, machine-readable failure codes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until this file, every failure ally-be returned was distinguishable only by
 * its HTTP status plus a free-text `message`. A client that wanted to react
 * differently to "you are not signed in", "your org has not enabled this",
 * "ally-ai is down, retry" and "ally-ai rejected the request, don't retry" had
 * to string-match prose that is meant to be reworded (and, eventually,
 * translated). Any rewording silently broke the client.
 *
 * CONTRACT
 * --------
 * - `errorCode` is ADDITIVE. It sits alongside the existing
 *   `statusCode`/`message`/`error` fields, so no existing client breaks.
 * - The VALUES are the contract, not the TypeScript member names. Never rename
 *   or repurpose a value once shipped — add a new one instead.
 * - A code answers "what kind of failure is this", never "what should the user
 *   read". User-facing wording lives in `failure-messages.ts` and is free to
 *   change without touching the code.
 * - Retryability is part of the code's meaning: `*_UNAVAILABLE` / `*_TIMEOUT` /
 *   `*_THROTTLED` are transient, everything else is terminal for that request.
 *
 * SCOPE
 * -----
 * Deliberately NOT retrofitted onto every throw site in the repo — a code on a
 * failure nobody branches on is noise. Wired through the contracts that already
 * carry good semantics: the auth guards, the feature-toggle 403, the
 * simulation-capacity 429, the rate limiter, and the ally-ai failures.
 */
export enum ErrorCode {
  // ── Generic ───────────────────────────────────────────────────────────────
  /** Unclassified server-side failure. The default when nothing better fits. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** A database statement failed. Details are server-side only, never returned. */
  DATABASE_ERROR = 'DATABASE_ERROR',
  /**
   * The deployment is missing configuration this request needs. Terminal for
   * the caller — retrying cannot help until an operator fixes the environment.
   */
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',

  // ── Authentication / authorization ────────────────────────────────────────
  /** 401. No (or no longer valid) identity on the request. Sign in again. */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** 403. Authenticated, but missing a required permission. */
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  /** 403. Authenticated, but holding none of the required roles. */
  ROLE_DENIED = 'ROLE_DENIED',
  /**
   * 403. Permission is fine; the feature itself is not switched on for this
   * user or their tenant. Distinct from PERMISSION_DENIED because the remedy is
   * different — an admin enables a toggle rather than granting a permission.
   */
  FEATURE_NOT_ENABLED = 'FEATURE_NOT_ENABLED',

  // ── Scribe voice note (dictation → note fields) ───────────────────────────
  /**
   * 500. The dictation was transcribed, but the field-extraction model failed.
   * The response still carries the `transcript`, because it is real work the
   * counsellor did with their voice and the alternative is throwing it away:
   * the client saves it to the note and falls back to the manual form. TERMINAL
   * for the extraction — the transcript is already in hand, so a client must
   * not re-upload the audio to get it.
   */
  VOICE_NOTE_EXTRACTION_FAILED = 'VOICE_NOTE_EXTRACTION_FAILED',

  // ── Throttling / capacity ─────────────────────────────────────────────────
  /** 429 from the rate limiter. Transient; honour `Retry-After`. */
  RATE_LIMITED = 'RATE_LIMITED',
  /**
   * 429 because every concurrent roleplay slot is in use. Transient, and not
   * the caller's fault — distinct from RATE_LIMITED, which is about this
   * caller's own request rate.
   */
  SIMULATION_CAPACITY_REACHED = 'SIMULATION_CAPACITY_REACHED',

  // ── Downstream AI services (ally-ai / ally-ai-learn) ──────────────────────
  /** ally-ai is unreachable or returned 502/503. Transient — safe to retry. */
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
  /** ally-ai did not answer inside this call's budget. Transient. */
  AI_SERVICE_TIMEOUT = 'AI_SERVICE_TIMEOUT',
  /** ally-ai (or its own upstream model provider) returned 429. Transient. */
  AI_SERVICE_THROTTLED = 'AI_SERVICE_THROTTLED',
  /**
   * ally-ai rejected the request with a 4xx. TERMINAL — the same request will
   * be rejected again, so a client must not retry it.
   */
  AI_REQUEST_REJECTED = 'AI_REQUEST_REJECTED',

  // ── Notifications ─────────────────────────────────────────────────────────
  /** An outbound email could not be handed to SES. */
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
}

/**
 * The shape this repo's exceptions put in their `HttpException` response body
 * so `CustomExceptionFilter` can lift the extras onto the JSON response.
 *
 * `retryAfterSeconds` is turned into the standard `Retry-After` header by the
 * filter — see its `catch()`. Anything transient that knows how long to wait
 * should set it; a 429 without it tells the client to guess.
 */
export interface ErrorResponsePayload {
  message: string;
  error: string;
  statusCode: number;
  errorCode: ErrorCode;
  retryAfterSeconds?: number;
}
