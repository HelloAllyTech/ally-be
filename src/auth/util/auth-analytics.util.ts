import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserSuspendedException } from '../exception/login.exception';
import {
  AuthFailureReason,
  AuthMethod,
  OtpFailureReason,
} from '../constants/auth-analytics.constants';

/** What a failed `AuthService.verifyOtpV2` call says about the code the learner typed. */
export enum OtpCheckOutcome {
  /** The code passed; the request failed later, on the account itself. */
  ACCEPTED = 'accepted',
  /** The code was checked and rejected. */
  REJECTED = 'rejected',
  /** The request died before any code was checked — report no otp_verified event. */
  NOT_CHECKED = 'not_checked',
}

/**
 * Splits a `verifyOtpV2` rejection into "was the code good?" and "why not?".
 *
 * `AuthService.verifyOtpV2` validates the OTP first and only then calls
 * `validateUserAndIssueTokens`, so a not-found / wrong-role / suspended failure
 * proves the code itself was correct. Reporting those as failed code checks
 * would put a floor under auth.otp_verified's failure rate that has nothing to
 * do with the codes we send.
 *
 * The invalid-vs-expired split reads the exception message, which is where that
 * distinction lives — `auth.service.ts` throws `UnauthorizedException` with
 * 'Invalid OTP', 'Expired OTP' or 'Invalid or expired OTP'. A missing cache
 * entry ('Invalid or expired OTP') is an expiry: the OTP key and the attempt key
 * share one TTL, so the only way to reach verify with nothing cached is to be
 * past it.
 */
export function classifyOtpVerification(error: unknown): {
  outcome: OtpCheckOutcome;
  failureReason: OtpFailureReason | null;
} {
  if (error instanceof UnauthorizedException) {
    const message = String(error.message ?? '').toLowerCase();
    return {
      outcome: OtpCheckOutcome.REJECTED,
      failureReason: message.includes('expired')
        ? OtpFailureReason.EXPIRED_CODE
        : OtpFailureReason.INVALID_CODE,
    };
  }

  if (
    error instanceof UserSuspendedException ||
    error instanceof NotFoundException ||
    error instanceof ForbiddenException
  ) {
    return { outcome: OtpCheckOutcome.ACCEPTED, failureReason: null };
  }

  // A bad request, a database outage, anything else: the code was never judged,
  // so stay silent rather than guess.
  return { outcome: OtpCheckOutcome.NOT_CHECKED, failureReason: null };
}

/**
 * `failure_reason` for auth.completed. Needs the method because an
 * `UnauthorizedException` means a bad code on the email path and an unverifiable
 * token on the Google one.
 */
export function authFailureReasonFrom(
  error: unknown,
  method: AuthMethod,
): AuthFailureReason {
  // Checked before ForbiddenException only because it is a 403 of its own; it
  // extends HttpException directly, so the order is defensive, not required.
  if (error instanceof UserSuspendedException) {
    return AuthFailureReason.ACCOUNT_SUSPENDED;
  }
  if (error instanceof NotFoundException) {
    return AuthFailureReason.ACCOUNT_NOT_FOUND;
  }
  if (error instanceof ForbiddenException) {
    return AuthFailureReason.ROLE_NOT_ALLOWED;
  }
  if (error instanceof UnauthorizedException) {
    return method === AuthMethod.EMAIL
      ? AuthFailureReason.OTP_FAILED
      : AuthFailureReason.INVALID_TOKEN;
  }
  return AuthFailureReason.UNKNOWN_ERROR;
}
