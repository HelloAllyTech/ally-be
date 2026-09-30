// rate-limit/decorators/rate-limited.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import { CustomThrottlerGuard } from '../guard/custom-throttler.guard';

import { SetMetadata } from '@nestjs/common';
import {
  RATE_LIMIT_KEY,
  THROTTLER_NAMES,
  ThrottlerName,
} from '../constants/rate.limit.constants';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

export interface RateLimitOptions {
  key?: 'ip' | 'userId';
  /** With `ttl` (ms), replaces the named throttler's numbers on this route. Give both or neither. */
  limit?: number;
  ttl?: number;
  /** The registered throttler this route is counted against. Defaults to `default`. */
  name?: ThrottlerName;
  errorMessage?: string;
}

/**
 * Throttle a route through CustomThrottlerGuard, counted against exactly one registered
 * throttler: `name`, at this route's own `limit`/`ttl` when it gives them.
 *
 * Every other registered throttler is skipped on the route. @nestjs/throttler would
 * otherwise run them all, which is how the bug-report route ended up on the otp limit.
 *
 * With `key: 'userId'`, write this ABOVE the route's auth guard. Guard decorators stack
 * bottom-up, so the lower one runs first, and the throttler needs `req.user` to exist.
 */
export const RateLimit = (options?: RateLimitOptions) => {
  const name = options?.name ?? 'default';
  // The type already says this. It is checked again because a name that slipped past it
  // (a cast, or ts-jest, which does not type-check) would skip every registered throttler
  // and leave the route unthrottled.
  if (!THROTTLER_NAMES.includes(name)) {
    throw new Error(
      `@RateLimit: '${name}' is not a registered throttler (${THROTTLER_NAMES.join(', ')}).`,
    );
  }
  if ((options?.limit === undefined) !== (options?.ttl === undefined)) {
    throw new Error(
      `@RateLimit: give limit and ttl together (throttler '${name}').`,
    );
  }

  const decorators = [
    UseGuards(CustomThrottlerGuard),
    SkipThrottle(
      Object.fromEntries(
        THROTTLER_NAMES.filter((other) => other !== name).map((other) => [
          other,
          true,
        ]),
      ),
    ),
  ];
  if (options) {
    decorators.push(SetMetadata(RATE_LIMIT_KEY, options));
  }
  if (options?.limit !== undefined && options.ttl !== undefined) {
    decorators.push(
      Throttle({
        [name]: {
          limit: options.limit,
          ttl: options.ttl,
        },
      }),
    );
  }

  return applyDecorators(...decorators);
};
