import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY } from '../constants/rate.limit.constants';
import { RateLimitOptions } from '../decorator/rate-limit.decorator';
import { AppConfigService } from '../../config/config.service';
import { ErrorCode } from '../../exception/error-code.enum';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly appConfigService: AppConfigService,
  ) {
    super(options, storageService, reflector);
  }
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.appConfigService.isLocal) {
      return Promise.resolve(true);
    }
    const req = context.switchToHttp().getRequest();
    req._context = context; // store context for access in getTracker()
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const context = req['_context'] as ExecutionContext; // Hack: track context if needed

    const rateLimitOptions = this.reflector.get(
      RATE_LIMIT_KEY,
      context?.getHandler?.(),
    ) as RateLimitOptions;

    const key = rateLimitOptions?.key || 'ip';

    if (key === 'userId' && req.user?.id) {
      return `user-${req.user.id}`;
    }

    return req.ips?.[0] || req.ip || 'unknown';
  }

  protected async getErrorMessage(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<string> {
    const error = await super.getErrorMessage(context, throttlerLimitDetail);
    const customError = this.reflector.get(
      RATE_LIMIT_KEY,
      context?.getHandler?.(),
    ) as RateLimitOptions;
    return customError?.errorMessage || error;
  }

  /**
   * Answer a throttled request with a `Retry-After` the client can act on.
   *
   * The base guard's own header is not enough here. It writes
   * `Retry-After-<name>` for any throttler that is not called `default`, and
   * this app registers a named `otp` throttler — so the ONE surface a user
   * actually hits a rate limit on (requesting a login code) was answering 429
   * with no standard header at all. A client that cannot read the wait either
   * guesses, or retries immediately and gets throttled again, which from the
   * user's side is a login screen that fails repeatedly for no stated reason.
   *
   * Both the canonical header and `retryAfterSeconds` in the body are set: the
   * header for HTTP-aware clients and proxies, the body field because the app's
   * own fetch layer reads the JSON and never looks at headers.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // `timeToBlockExpire` is seconds in @nestjs/throttler v6. Floor at 1: a
    // `Retry-After: 0` reads as "retry now", which is the opposite of the point.
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        throttlerLimitDetail.timeToBlockExpire ||
          throttlerLimitDetail.timeToExpire ||
          throttlerLimitDetail.ttl / 1000,
      ),
    );

    const response = context.switchToHttp().getResponse();
    // Set here as well as in the exception filter, so the header survives even
    // if a future filter change stops lifting `retryAfterSeconds` out of the body.
    response?.setHeader?.('Retry-After', String(retryAfterSeconds));

    throw new HttpException(
      {
        message: await this.getErrorMessage(context, throttlerLimitDetail),
        error: 'Too Many Requests',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: ErrorCode.RATE_LIMITED,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
