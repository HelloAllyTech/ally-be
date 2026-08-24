import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { LoggerService } from '../logger/logger.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationErrorType } from '../notification/type/notification.error.type';
import { EntityOperationException } from './custom.exception';
import { ErrorCode } from './error-code.enum';
import { FAILURE_MESSAGES } from './failure-messages';
@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  constructor(private eventEmitter: EventEmitter2) {}
  private logger = LoggerService.getInstance(CustomExceptionFilter.name);

  // TODO: Add a way to handle entityId in the response generically
  catch(exception: unknown, host: ArgumentsHost) {
    // Error's `message`/`stack` are non-enumerable, so logging the raw
    // exception object stringifies to `{}` and hides the real failure.
    // Log a serializable representation (name + message + stack) instead.
    const reqForLog = host.switchToHttp().getRequest();
    this.logger.error(
      exception instanceof Error
        ? `${reqForLog?.method} ${reqForLog?.url} -> ${exception.name}: ${exception.message}\n${exception.stack}`
        : exception,
    );
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    // Additive machine-readable classification. Only ever set from a value the
    // throwing code chose deliberately (see ErrorCode's contract note) or from
    // the small set of cases classified below — never guessed from prose.
    let errorCode: ErrorCode | undefined;
    let retryAfterSeconds: number | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === 'string'
          ? errorResponse
          : (errorResponse as any).message || exception.message;
      error = (errorResponse as any).error || 'Error';
      if (typeof errorResponse === 'object' && errorResponse !== null) {
        const { errorCode: code, retryAfterSeconds: retryAfter } =
          errorResponse as {
            errorCode?: ErrorCode;
            retryAfterSeconds?: number;
          };
        errorCode = code;
        if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
          retryAfterSeconds = Math.max(1, Math.ceil(retryAfter));
        }
      }
    } else if (exception instanceof QueryFailedError) {
      // NEVER return the driver string. `exception.message` is the raw Postgres
      // error, which names the column, constraint and table that failed — a free
      // schema map for anyone probing the API, and it used to be shipped
      // verbatim as the response's `error` field. It is already in the log line
      // at the top of this method (name + message + stack), which is where it
      // belongs; the client gets a generic, actionable sentence plus a code.
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = FAILURE_MESSAGES.DATABASE_ERROR;
      error = 'Internal Server Error';
      errorCode = ErrorCode.DATABASE_ERROR;
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    // Standard 429 hint. Sourced only from an exception that actually knows the
    // wait (the rate limiter and the simulation-capacity 429 both set it) — the
    // filter never invents a number, because a wrong Retry-After is worse than
    // none: a client that trusts it retries into the same wall.
    if (retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }

    const body: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
      message,
      error,
    };
    // Additive: omitted entirely when the throw site did not classify itself,
    // so an existing client's response shape is byte-identical to before.
    if (errorCode) {
      body.errorCode = errorCode;
    }
    if (retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = retryAfterSeconds;
    }
    if (exception instanceof EntityOperationException) {
      body.entityId = (exception.getResponse() as any).entityId;
    }
    response.status(status).json(body);

    this.eventEmitter.emit('exception', {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
      message,
      type: 'Request Error',
    } as NotificationErrorType);
  }
}
