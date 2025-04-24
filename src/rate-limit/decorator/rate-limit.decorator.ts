// rate-limit/decorators/rate-limited.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import { CustomThrottlerGuard } from '../guard/custom-throttler.guard';

import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '../constants/rate.limit.constants';
import { Throttle } from '@nestjs/throttler';

export interface RateLimitOptions {
  key?: 'ip' | 'userId';
  limit?: number;
  ttl?: number;
  name?: string;
  errorMessage?: string;
}

export const RateLimit = (options?: RateLimitOptions) => {
  const decorators = [UseGuards(CustomThrottlerGuard)];
  if (options) {
    decorators.push(SetMetadata(RATE_LIMIT_KEY, options));
  }
  if (options?.limit && options?.ttl) {
    decorators.push(
      Throttle({
        [options.name || 'default']: {
          limit: options.limit,
          ttl: options.ttl,
        },
      }),
    );
  }

  return applyDecorators(...decorators);
};
