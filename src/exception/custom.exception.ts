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
