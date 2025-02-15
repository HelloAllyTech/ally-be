import { HttpException, HttpStatus } from '@nestjs/common';

export class CustomException extends HttpException {
  constructor(
    message: string,
    errorCode: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    error?: any,
  ) {
    super(
      {
        message,
        errorCode,
        statusCode,
        error,
        timestamp: new Date().toISOString(),
      },
      statusCode,
    );
  }
}

export class ValidationException extends CustomException {
  constructor(message: string, error?: any) {
    super(message, 'VALIDATION_ERROR', HttpStatus.BAD_REQUEST, error);
  }
}

export class NotFoundException extends CustomException {
  constructor(message: string, error?: any) {
    super(message, 'NOT_FOUND', HttpStatus.NOT_FOUND, error);
  }
}

export class UnauthorizedException extends CustomException {
  constructor(message: string, error?: any) {
    super(message, 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED, error);
  }
}

export class ForbiddenException extends CustomException {
  constructor(message: string, error?: any) {
    super(message, 'FORBIDDEN', HttpStatus.FORBIDDEN, error);
  }
}
