/**
 * PostHog events for the Login & Signup funnel.
 *
 * Fired from `AuthController` (and `auth.terms_accepted` from `UserController`,
 * which owns the endpoint the learner actually hits when they accept). Names and
 * property values are the analytics spec's, verbatim — changing one here without
 * changing it in the spec silently breaks the dashboards built on it.
 */
export const AUTH_ANALYTICS_EVENTS = {
  STARTED: 'auth.started',
  OTP_VERIFIED: 'auth.otp_verified',
  OTP_RESENT: 'auth.otp_resent',
  TERMS_ACCEPTED: 'auth.terms_accepted',
  COMPLETED: 'auth.completed',
} as const;

/** `method` on auth.started / auth.completed. */
export enum AuthMethod {
  EMAIL = 'email',
  GOOGLE_OAUTH = 'google_oauth',
}

/** `status` on auth.otp_verified / auth.completed. */
export enum AuthStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

/** `failure_reason` on auth.otp_verified. */
export enum OtpFailureReason {
  INVALID_CODE = 'invalid_code',
  EXPIRED_CODE = 'expired_code',
}

/**
 * `failure_reason` on auth.completed.
 *
 * The spec marks this enum UNCONFIRMED and lists `otp_failed | terms_declined |
 * network_error | null`. Two of those three are client-side outcomes the server
 * never observes — a learner who declines the terms or loses their connection
 * simply never sends another request — so they are declared here for the client
 * to use but are never emitted by this service. The remaining values cover the
 * ways a login actually fails server-side; fold them back into the spec.
 */
export enum AuthFailureReason {
  /** Wrong or expired code at verify-otp, and unusable magic-link style input. */
  OTP_FAILED = 'otp_failed',
  /** Client-side only. */
  TERMS_DECLINED = 'terms_declined',
  /** Client-side only. */
  NETWORK_ERROR = 'network_error',
  /** Google returned a token we could not verify. */
  INVALID_TOKEN = 'invalid_token',
  /** Verified identity, but no active account on this platform. */
  ACCOUNT_NOT_FOUND = 'account_not_found',
  /** Account exists but holds none of the roles the calling app allows. */
  ROLE_NOT_ALLOWED = 'role_not_allowed',
  ACCOUNT_SUSPENDED = 'account_suspended',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * Version of the Terms & Agreement in force, reported as `terms_version` on
 * auth.terms_accepted.
 *
 * UNCONFIRMED, and a constant rather than a lookup because `users` stores only
 * `termsAndAgreementApproved` (a boolean) plus a timestamp — there is no
 * per-user version to read back. Bump this whenever the terms copy changes, or
 * replace it with a real version column if acceptances ever need to be
 * attributed to the exact text the learner saw.
 */
export const TERMS_AND_AGREEMENT_VERSION = 'v1.2';
