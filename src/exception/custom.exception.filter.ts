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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === 'string'
          ? errorResponse
          : (errorResponse as any).message || exception.message;
      error = (errorResponse as any).error || 'Error';
    } else if (exception instanceof QueryFailedError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Database query failed';
      error = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    if (exception instanceof EntityOperationException) {
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: ctx.getRequest().url,
        message,
        error,
        entityId: (exception.getResponse() as any).entityId,
      });
    } else {
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: ctx.getRequest().url,
        message,
        error,
      });
    }

    this.eventEmitter.emit('exception', {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
      message,
      type: 'Request Error',
    } as NotificationErrorType);
  }
}
