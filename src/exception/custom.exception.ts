import { HttpException, HttpStatus } from '@nestjs/common';

export class CustomException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(
      {
        message,
        error: 'Custom Error',
        status,
      },
      status,
    );
  }
}

export class ResourceNotFoundException extends CustomException {
  constructor(resource: string) {
    super(`${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class UnauthorizedException extends CustomException {
  constructor(message: string = 'Unauthorized access') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class ValidationException extends CustomException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class NotFoundException extends CustomException {
  constructor(message: string) {
    super(message, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenException extends CustomException {
  constructor(message: string) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class OrganizationRequiredException extends HttpException {
  constructor() {
    super(
      {
        message: 'Organization ID is required for non-public documents',
        error: 'Organization Required',
        status: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class FailedDependencyException extends HttpException {
  constructor(message: any) {
    super(message, HttpStatus.FAILED_DEPENDENCY);
  }
}

export class EntityOperationException extends HttpException {
  constructor(message: string, entityId: string) {
    super(
      {
        message,
        entityId,
        error: 'Entity Operation Error',
        status: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Scribe dictation was transcribed, but the field-extraction model failed.
 *
 * Exists as its own class for the same reason `EntityOperationException` does:
 * `CustomExceptionFilter` builds the response body from a fixed set of fields,
 * so an extra key on the thrown payload is silently dropped unless the filter
 * knows to carry it. Here that key is the transcript, and dropping it is the
 * whole bug — the counsellor spoke the note once and would otherwise have to
 * speak it again because a downstream model had a bad minute.
 *
 * The transcript is clinical content, but it is the same content this endpoint
 * returns in its 200 body to the same authenticated counsellor, so carrying it
 * on the failure exposes nothing new.
 */
export class VoiceNoteExtractionFailedException extends HttpException {
  constructor(
    message: string,
    errorCode: string,
    public readonly transcript: string,
  ) {
    super(
      {
        message,
        error: 'Internal Server Error',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode,
        transcript,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export default function isDuplicateKeyException(
  error: any,
  constraintName?: string,
): boolean {
  return (
    error &&
    error.name === 'QueryFailedError' &&
    error.code === '23505' &&
    (constraintName ? error.constraint === constraintName : true)
  );
}
