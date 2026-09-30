import { ThrottlerOptions } from '@nestjs/throttler';
import {
  THROTTLER_NAMES,
  ThrottlerName,
} from './constants/rate.limit.constants';

/**
 * The throttlers RateLimitModule registers: one per THROTTLER_NAMES entry.
 *
 * Kept out of the module file so a spec can register exactly these without importing
 * AppConfigModule (whose env validation needs a real environment) or a Redis client.
 */
export function registeredThrottlers(otp: {
  limit: number;
  ttl: number;
}): ThrottlerOptions[] {
  // Keyed by ThrottlerName, so leaving a name out, or registering one THROTTLER_NAMES does
  // not list, fails to compile. An unlisted throttler would never be skipped by @RateLimit
  // and would run on every rate-limited route.
  const byName: Record<ThrottlerName, Omit<ThrottlerOptions, 'name'>> = {
    default: { limit: 100, ttl: 1000 },
    otp: { limit: otp.limit, ttl: otp.ttl },
  };
  return THROTTLER_NAMES.map((name) => ({ name, ...byName[name] }));
}
