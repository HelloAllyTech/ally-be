import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';

const REASON: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

/**
 * An HttpException whose body carries `errorCode`, which
 * `CustomExceptionFilter` lifts onto the JSON response
 * (`{ statusCode, message, error, errorCode }`, contract §5).
 */
export function helplineError(
  status: HttpStatus,
  errorCode: ErrorCode,
  message: string,
): HttpException {
  return new HttpException(
    {
      statusCode: status,
      message,
      error: REASON[status] ?? 'Error',
      errorCode,
    },
    status,
  );
}

/** Not found — also what a caller with no access gets, so existence is never confirmed. */
export const chatNotFound = () =>
  helplineError(
    HttpStatus.NOT_FOUND,
    ErrorCode.HELPLINE_CHAT_NOT_FOUND,
    'Chat not found',
  );

export const helplineDisabled = () =>
  helplineError(
    HttpStatus.FORBIDDEN,
    ErrorCode.HELPLINE_DISABLED,
    'The text helpline is not available for this organisation',
  );

export const guestTokenInvalid = () =>
  helplineError(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.HELPLINE_GUEST_TOKEN_INVALID,
    'This chat session is no longer valid',
  );

export const chatEnded = (message = 'This chat has ended') =>
  helplineError(HttpStatus.CONFLICT, ErrorCode.HELPLINE_CHAT_ENDED, message);

export const badRequest = (message: string) =>
  new HttpException(
    { statusCode: HttpStatus.BAD_REQUEST, message, error: 'Bad Request' },
    HttpStatus.BAD_REQUEST,
  );

/** Postgres unique_violation. */
export const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === '23505' ||
  (error as { driverError?: { code?: string } } | null)?.driverError?.code ===
    '23505';

/**
 * Rows from `query('UPDATE … RETURNING …')`. TypeORM's postgres driver returns
 * `[rows, affectedCount]` for UPDATE/DELETE and a bare `rows` array otherwise;
 * reading the tuple as rows is the bug that once made "session not found" out
 * of a successful copilot write.
 */
export function returningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
