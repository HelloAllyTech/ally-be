import { HttpStatus, HttpException } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';

/**
 * A login-code limit kept per email address (see `OTP_LIMITS`), in the same
 * shape as the rate limiter's own 429: `errorCode: RATE_LIMITED`, plus
 * `retryAfterSeconds`, which `CustomExceptionFilter` turns into `Retry-After`.
 */
export class OtpRateLimitedException extends HttpException {
  constructor(message: string, retryAfterSeconds: number) {
    super(
      {
        message,
        error: 'Too Many Requests',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: ErrorCode.RATE_LIMITED,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class UserSuspendedException extends HttpException {
  public originalError?: any;

  constructor(originalError?: any) {
    super(
      {
        message: `User suspended`,
        error: 'USER_SUSPENDED',
        status: HttpStatus.FORBIDDEN,
      },
      HttpStatus.FORBIDDEN,
    );
    this.originalError = originalError;
  }
}
