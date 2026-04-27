import { ExecutionContext, Injectable } from '@nestjs/common';
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
}
