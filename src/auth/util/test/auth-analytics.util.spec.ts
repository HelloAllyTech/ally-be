import { UnauthorizedException } from '@nestjs/common';
import {
  AuthFailureReason,
  AuthMethod,
  OtpFailureReason,
} from '../../constants/auth-analytics.constants';
import { OTP_LIMIT_MESSAGES } from '../../constants/otp-limits.constants';
import { OtpRateLimitedException } from '../../exception/login.exception';
import {
  authFailureReasonFrom,
  classifyOtpVerification,
  OtpCheckOutcome,
} from '../auth-analytics.util';

describe('auth analytics for the login-code limits', () => {
  const dailyLimit = new OtpRateLimitedException(
    OTP_LIMIT_MESSAGES.dailyGuesses('24 hours'),
    86400,
  );

  it('reports a per-email limit as rate_limited, not unknown_error', () => {
    expect(authFailureReasonFrom(dailyLimit, AuthMethod.EMAIL)).toBe(
      AuthFailureReason.RATE_LIMITED,
    );
  });

  it('reports no code check when the daily limit refused before comparing', () => {
    expect(classifyOtpVerification(dailyLimit)).toEqual({
      outcome: OtpCheckOutcome.NOT_CHECKED,
      failureReason: null,
    });
  });

  it('reports the check that destroys a code as a rejected code', () => {
    const locked = new UnauthorizedException(OTP_LIMIT_MESSAGES.CODE_LOCKED);

    expect(classifyOtpVerification(locked)).toEqual({
      outcome: OtpCheckOutcome.REJECTED,
      failureReason: OtpFailureReason.INVALID_CODE,
    });
    expect(authFailureReasonFrom(locked, AuthMethod.EMAIL)).toBe(
      AuthFailureReason.OTP_FAILED,
    );
  });
});
