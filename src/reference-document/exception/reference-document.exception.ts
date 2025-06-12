import { HttpException, HttpStatus } from '@nestjs/common';
export class SearchOperationFailedException extends HttpException {
  public originalError?: any;

  constructor(message = 'Search operation failed', error?: any) {
    const enhancedMessage = error?.message
      ? `${message}: ${error.message}`
      : message;

    super(
      {
        message: enhancedMessage,
        error: 'Search Operation Failed',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.originalError = error;
  }
}
