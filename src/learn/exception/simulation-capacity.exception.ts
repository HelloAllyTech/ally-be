import { HttpException, HttpStatus } from '@nestjs/common';

export class SimulationCapacityException extends HttpException {
  constructor(maxConcurrent: number) {
    super(
      {
        message: `We're currently handling maximum number of active users. Please wait a moment and try again. Access usually frees up shortly.`,
        error: `We're at capacity right now`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        maxConcurrentSimulations: maxConcurrent,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
