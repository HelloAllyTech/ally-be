import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
  THROTTLER_LIMIT,
  THROTTLER_SKIP,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { RateLimit, RateLimitOptions } from '../rate-limit.decorator';
import { CustomThrottlerGuard } from '../../guard/custom-throttler.guard';
import {
  RATE_LIMIT_KEY,
  ThrottlerName,
} from '../../constants/rate.limit.constants';

/**
 * Applies @RateLimit to a handler and reads the result back the way ThrottlerGuard does:
 * per registered throttler name, handler first, then class. Asserting on that, rather than
 * on which decorator factories were called, is what would have caught an override filed
 * under a name the guard never looks up.
 */
function decorate(options?: RateLimitOptions) {
  class TestController {
    @RateLimit(options)
    handler() {}
  }
  const handler = TestController.prototype.handler;
  const reflector = new Reflector();
  const read = (key: string) =>
    reflector.getAllAndOverride(key, [handler, TestController]);

  return {
    guards: Reflect.getMetadata(GUARDS_METADATA, handler),
    options: Reflect.getMetadata(RATE_LIMIT_KEY, handler),
    skips: (name: ThrottlerName) => read(THROTTLER_SKIP + name) === true,
    limit: (name: ThrottlerName) => read(THROTTLER_LIMIT + name),
    ttl: (name: ThrottlerName) => read(THROTTLER_TTL + name),
  };
}

describe('RateLimit Decorator', () => {
  it('should guard the route with CustomThrottlerGuard', () => {
    expect(decorate().guards).toEqual([CustomThrottlerGuard]);
  });

  it('should count a route that names no throttler against default, and skip the rest', () => {
    const route = decorate({ key: 'ip' });

    expect(route.skips('default')).toBe(false);
    expect(route.skips('otp')).toBe(true);
  });

  it('should count a route against the throttler it names, and skip the rest', () => {
    const route = decorate({ name: 'otp', key: 'ip' });

    expect(route.skips('otp')).toBe(false);
    expect(route.skips('default')).toBe(true);
  });

  it('should leave the registered numbers alone when given no limit/ttl', () => {
    const route = decorate({ name: 'otp' });

    expect(route.limit('otp')).toBeUndefined();
    expect(route.ttl('otp')).toBeUndefined();
  });

  it('should file a limit/ttl override under the named throttler', () => {
    const route = decorate({ name: 'otp', limit: 3, ttl: 60_000 });

    expect(route.limit('otp')).toBe(3);
    expect(route.ttl('otp')).toBe(60_000);
    expect(route.limit('default')).toBeUndefined();
  });

  it('should file an override that names no throttler under default', () => {
    const route = decorate({ key: 'userId', limit: 8, ttl: 3_600_000 });

    expect(route.limit('default')).toBe(8);
    expect(route.ttl('default')).toBe(3_600_000);
    expect(route.skips('otp')).toBe(true);
  });

  it('should record key and errorMessage for the guard', () => {
    const options: RateLimitOptions = {
      key: 'userId',
      errorMessage: 'Custom error',
    };

    expect(decorate(options).options).toEqual(options);
  });

  it('should record nothing for the guard when given no options', () => {
    expect(decorate().options).toBeUndefined();
  });

  it.each<RateLimitOptions>([{ limit: 8 }, { ttl: 3_600_000 }])(
    'should refuse half an override (%j)',
    (options) => {
      expect(() => RateLimit(options)).toThrow('give limit and ttl together');
    },
  );

  it('should refuse a throttler name that is not registered', () => {
    expect(() =>
      RateLimit({
        name: 'bugReport' as ThrottlerName,
        limit: 8,
        ttl: 3_600_000,
      }),
    ).toThrow("'bugReport' is not a registered throttler");
  });
});
