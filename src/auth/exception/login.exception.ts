import { HttpStatus, HttpException } from '@nestjs/common';

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
