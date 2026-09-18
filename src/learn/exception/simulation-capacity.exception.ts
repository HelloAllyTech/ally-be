import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';

/**
 * How long to tell the learner to wait before trying again.
 *
 * 30 seconds, chosen to match the words the message already uses ("wait a
 * moment", "frees up shortly") rather than being invented separately. A slot
 * frees when someone else's roleplay ends, which is not predictable from here,
 * so this is a POLL INTERVAL and not a promise: short enough that a freed slot
 * is taken up promptly, long enough that a client honouring it does not hammer
 * a service that is already at its ceiling.
 *
 * If a caller ever learns the earliest actual end time, pass it in — a real
 * number is always better than this one.
 */
const DEFAULT_CAPACITY_RETRY_AFTER_SECONDS = 30;

/**
 * Every concurrent roleplay slot is in use.
 *
 * Carries `retryAfterSeconds`, which `CustomExceptionFilter` turns into the
 * standard `Retry-After` header. Without it this was a 429 that told the reader
 * to "wait a moment and try again" and told the CLIENT nothing at all — so the
 * client either gave up or retried straight into the same wall. A wait hint is
 * the actionable half of the message.
 */
export class SimulationCapacityException extends HttpException {
  constructor(
    maxConcurrent: number,
    retryAfterSeconds: number = DEFAULT_CAPACITY_RETRY_AFTER_SECONDS,
  ) {
    super(
      {
        // TODO(i18n): English-only, like every other exception message in this
        // repo. Left in place rather than moved into `failure-messages.ts`
        // because this wording is specific to one surface and the file is the
        // home for strings shared across throw sites; the marker is here so a
        // future i18n pass finds it.
        message: `We're currently handling maximum number of active users. Please wait a moment and try again. Access usually frees up shortly.`,
        error: `We're at capacity right now`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: ErrorCode.SIMULATION_CAPACITY_REACHED,
        maxConcurrentSimulations: maxConcurrent,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
