export const RATE_LIMIT_KEY = 'rate_limit:options';

/**
 * Every throttler RateLimitModule registers, and so the only names `@RateLimit` accepts.
 *
 * Two @nestjs/throttler behaviours make this list load-bearing. Its guard reads a route's
 * `@Throttle` override only under a registered name, so an override filed under any other
 * name is dropped without a word. And it runs EVERY registered throttler on every route it
 * guards unless the route skips it. So `@RateLimit` skips all of these except the one a
 * route names, and `registeredThrottlers` builds the registration from this same list, so
 * the two cannot drift apart.
 */
export const THROTTLER_NAMES = ['default', 'otp'] as const;

export type ThrottlerName = (typeof THROTTLER_NAMES)[number];
