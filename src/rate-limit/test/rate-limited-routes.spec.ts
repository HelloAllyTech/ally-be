import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Provider,
  Type,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PostHog } from 'posthog-node';
import * as request from 'supertest';

import { AuthController } from 'src/auth/controller/auth.controller';
import { FeatureToggleGuard } from 'src/auth/guards/feature-toggle.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from 'src/auth/guards/jwt-refresh-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { AuthService } from 'src/auth/service/auth.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TRUSTED_PROXY_HOPS } from 'src/common/constants/network.constants';
import { TIME } from 'src/common/constants/time.constants';
import { AppConfigService } from 'src/config/config.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LabEvalPortalController } from 'src/lab/controller/lab-eval-portal.controller';
import { LabEvaluatorGuard } from 'src/lab/guard/lab-evaluator.guard';
import { LabEvalService } from 'src/lab/service/lab-eval.service';
import { LabEvaluatorService } from 'src/lab/service/lab-evaluator.service';
import { BUG_REPORT_RATE_LIMIT } from 'src/product-roadmap/constants/product-roadmap.constants';
import { RoadmapOpportunityController } from 'src/product-roadmap/controller/roadmap-opportunity.controller';
import { RoadmapAccessService } from 'src/product-roadmap/service/roadmap-access.service';
import { RoadmapAllocationService } from 'src/product-roadmap/service/roadmap-allocation.service';
import { RoadmapBoardService } from 'src/product-roadmap/service/roadmap-board.service';
import { RoadmapBuilderService } from 'src/product-roadmap/service/roadmap-builder.service';
import { RoadmapOpportunityService } from 'src/product-roadmap/service/roadmap-opportunity.service';
import { RoadmapSplitMergeService } from 'src/product-roadmap/service/roadmap-split-merge.service';
import {
  HELPLINE_SESSION_RATE_LIMIT,
  HelplinePublicController,
} from 'src/helpline/controller/helpline-public.controller';
import { HelplineSessionService } from 'src/helpline/service/helpline-session.service';
import { registeredThrottlers } from '../rate-limit.throttlers';

/**
 * Every @RateLimit route, driven over HTTP through its real controller, against the
 * throttlers RateLimitModule registers — in-memory storage stands in for Redis.
 *
 * What this pins is that each route is counted against exactly the one throttler it names,
 * at the numbers it means. @nestjs/throttler fails the other way silently: it runs every
 * registered throttler on every guarded route, and drops a route's override filed under a
 * name it does not know. The bug-report route's 8/hour had been doing both, so it actually
 * ran at the otp limit (5 per 10 minutes) plus the default (100 a second).
 *
 * The X-RateLimit-* headers are how the tests see which throttlers ran: the guard writes
 * `X-RateLimit-Limit` for the throttler called `default` and `X-RateLimit-Limit-<name>` for
 * any other, once per throttler it evaluated.
 */

/** AppConfigService.rateLimit.otp's defaults — the otp throttler's numbers unless env overrides them. */
const OTP = { limit: 5, ttl: 10 * TIME.MINUTE_IN_MS };

const allow: CanActivate = { canActivate: () => true };

/**
 * Stands in for JwtAuthGuard: authenticates from a header and sets req.user, as passport
 * does. A throttler that runs before it finds no user.
 */
const authenticateFromHeader: CanActivate = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user'];
    if (!userId) {
      throw new UnauthorizedException();
    }
    req.user = { id: userId, tenantId: null };
    return true;
  },
};

async function boot(
  controller: Type<unknown>,
  providers: Provider[],
  guardStubs: [guard: Type<unknown>, stub: CanActivate][],
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({ throttlers: registeredThrottlers(OTP) }),
    ],
    controllers: [controller],
    providers: [
      ...providers,
      // isLocal switches the guard off; this is how it runs everywhere else.
      { provide: AppConfigService, useValue: { isLocal: false } },
    ],
  });
  for (const [guard, stub] of guardStubs) {
    builder = builder.overrideGuard(guard).useValue(stub);
  }
  const app = (
    await builder.compile()
  ).createNestApplication<NestExpressApplication>();
  // As main.ts does: the real paths, and req.ip resolved through the load balancer, which
  // the test client plays.
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  return app;
}

describe('Rate-limited routes', () => {
  let app: INestApplication;

  afterEach(async () => {
    jest.useRealTimers();
    await app?.close();
  });

  describe('POST /api/v1/product-roadmap/bug-reports: 8 an hour per user', () => {
    let createBugReport: jest.Mock;

    beforeEach(async () => {
      createBugReport = jest.fn().mockResolvedValue({ id: 'bug-report-id' });
      app = await boot(
        RoadmapOpportunityController,
        [
          {
            provide: RoadmapOpportunityService,
            useValue: { createBugReport },
          },
          { provide: RoadmapAllocationService, useValue: {} },
          { provide: RoadmapSplitMergeService, useValue: {} },
          { provide: RoadmapBuilderService, useValue: {} },
          { provide: RoadmapBoardService, useValue: {} },
          { provide: RoadmapAccessService, useValue: {} },
        ],
        [
          [JwtAuthGuard, authenticateFromHeader],
          // The controller's other routes' guards; nothing here reaches them.
          [AuthGuard('jwt'), allow],
          [PermissionsGuard, allow],
          [FeatureToggleGuard, allow],
        ],
      );
    });

    const fileAs = (userId: string) =>
      request(app.getHttpServer())
        .post('/api/v1/product-roadmap/bug-reports')
        .set('x-test-user', userId)
        .send({ description: 'The save button does nothing' });

    it('is configured at 8 an hour', () => {
      expect(BUG_REPORT_RATE_LIMIT).toEqual({
        LIMIT: 8,
        TTL_MS: TIME.HOUR_IN_MS,
      });
    });

    it('accepts 8 reports from one user and refuses the 9th, for an hour', async () => {
      for (let n = 1; n <= 8; n++) {
        await fileAs('user-a').expect(201);
      }

      const refused = await fileAs('user-a').expect(429);

      expect(refused.headers['retry-after']).toBe('3600');
      expect(refused.body).toMatchObject({
        message: 'Too many bug reports. Please try again later.',
        errorCode: ErrorCode.RATE_LIMITED,
        retryAfterSeconds: 3600,
      });
      expect(createBugReport).toHaveBeenCalledTimes(8);
    });

    it('counts each user separately', async () => {
      for (let n = 1; n <= 8; n++) {
        await fileAs('user-a').expect(201);
      }
      await fileAs('user-a').expect(429);

      await fileAs('user-b').expect(201);
    });

    it('accepts reports from that user again once the hour is up', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      for (let n = 1; n <= 8; n++) {
        await fileAs('user-a').expect(201);
      }
      await fileAs('user-a').expect(429);

      jest.advanceTimersByTime(59 * TIME.MINUTE_IN_MS);
      const stillRefused = await fileAs('user-a').expect(429);
      expect(stillRefused.headers['retry-after']).toBe('60');

      jest.advanceTimersByTime(TIME.MINUTE_IN_MS);
      await fileAs('user-a').expect(201);
    });

    it('runs only its own throttler — not otp, and not the default 100 a second', async () => {
      const accepted = await fileAs('user-a').expect(201);

      expect(accepted.headers['x-ratelimit-limit']).toBe('8');
      expect(accepted.headers['x-ratelimit-reset']).toBe('3600');
      expect(accepted.headers).not.toHaveProperty('x-ratelimit-limit-otp');
    });
  });

  describe('POST /api/v1/auth/magic-link/verify: the otp throttler, per address', () => {
    beforeEach(async () => {
      app = await boot(
        AuthController,
        [
          {
            provide: AuthService,
            useValue: {
              verifyMagicLink: jest
                .fn()
                .mockResolvedValue({ accessToken: 'access-token' }),
            },
          },
          { provide: PermissionsService, useValue: {} },
          {
            provide: PostHog,
            useValue: { capture: jest.fn(), alias: jest.fn() },
          },
        ],
        [
          [JwtAuthGuard, allow],
          [JwtRefreshAuthGuard, allow],
          [AuthGuard('jwt'), allow],
          [PermissionsGuard, allow],
        ],
      );
    });

    const verify = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/magic-link/verify')
        .send({ token: 'magic-link-token' });

    it('allows 5 attempts in 10 minutes and refuses the 6th with its own message', async () => {
      for (let n = 1; n <= 5; n++) {
        await verify().expect(200);
      }

      const refused = await verify().expect(429);

      expect(refused.headers['retry-after']).toBe('600');
      expect(refused.body.message).toBe(
        'Too many magic link verification attempts. Please try again later.',
      );
    });

    it('runs only the otp throttler', async () => {
      const accepted = await verify().expect(200);

      expect(accepted.headers['x-ratelimit-limit-otp']).toBe('5');
      expect(accepted.headers).not.toHaveProperty('x-ratelimit-limit');
    });

    // X-Forwarded-For as the load balancer leaves it; RFC 5737 documentation addresses.
    it('counts each client behind the load balancer separately, and a spoofed address buys no fresh bucket', async () => {
      const verifyFrom = (xForwardedFor: string) =>
        verify().set('X-Forwarded-For', xForwardedFor);
      for (let n = 1; n <= 5; n++) {
        await verifyFrom('203.0.113.7').expect(200);
      }
      await verifyFrom('203.0.113.7').expect(429);

      await verifyFrom('198.51.100.66, 203.0.113.7').expect(429);
      await verifyFrom('203.0.113.8').expect(200);
    });
  });

  describe('POST /api/v1/helpline/public/:tenantCode/session: 5 an hour per address', () => {
    let createSession: jest.Mock;

    beforeEach(async () => {
      createSession = jest
        .fn()
        .mockResolvedValue({ guestToken: 'guest-token' });
      app = await boot(
        HelplinePublicController,
        [{ provide: HelplineSessionService, useValue: { createSession } }],
        [],
      );
    });

    const startFrom = (xForwardedFor: string) =>
      request(app.getHttpServer())
        .post('/api/v1/helpline/public/acme/session')
        .set('X-Forwarded-For', xForwardedFor)
        .send({ consentVersion: '2026-10-05', language: 'en' });

    it('is configured at 5 an hour', () => {
      expect(HELPLINE_SESSION_RATE_LIMIT).toMatchObject({
        LIMIT: 5,
        TTL_MS: TIME.HOUR_IN_MS,
      });
    });

    it('accepts 5 sessions from one address and refuses the 6th, for an hour', async () => {
      for (let n = 1; n <= 5; n++) {
        await startFrom('203.0.113.7').expect(201);
      }

      const refused = await startFrom('203.0.113.7').expect(429);

      expect(refused.headers['retry-after']).toBe('3600');
      expect(refused.body).toMatchObject({
        message: HELPLINE_SESSION_RATE_LIMIT.MESSAGE,
        errorCode: ErrorCode.RATE_LIMITED,
      });
      expect(createSession).toHaveBeenCalledTimes(5);
    });

    it('counts each address separately, and hands the service the real client address', async () => {
      for (let n = 1; n <= 5; n++) {
        await startFrom('203.0.113.7').expect(201);
      }
      await startFrom('203.0.113.7').expect(429);
      await startFrom('203.0.113.8').expect(201);
      expect(createSession).toHaveBeenLastCalledWith(
        'acme',
        expect.objectContaining({ ip: '203.0.113.8' }),
      );
    });

    it('runs only its own numbers on the default throttler — not otp, not 100 a second', async () => {
      const accepted = await startFrom('203.0.113.7').expect(201);

      expect(accepted.headers['x-ratelimit-limit']).toBe('5');
      expect(accepted.headers['x-ratelimit-reset']).toBe('3600');
      expect(accepted.headers).not.toHaveProperty('x-ratelimit-limit-otp');
    });
  });

  describe('POST /api/v1/lab/eval/login: the otp throttler, per address', () => {
    beforeEach(async () => {
      app = await boot(
        LabEvalPortalController,
        [
          {
            provide: LabEvaluatorService,
            useValue: {
              login: jest
                .fn()
                .mockResolvedValue({ accessToken: 'evaluator-token' }),
            },
          },
          { provide: LabEvalService, useValue: {} },
        ],
        [[LabEvaluatorGuard, allow]],
      );
    });

    const logIn = () =>
      request(app.getHttpServer())
        .post('/api/v1/lab/eval/login')
        .send({ email: 'evaluator@example.com', password: 'test-password' });

    it('allows 5 attempts in 10 minutes and refuses the 6th with its own message', async () => {
      for (let n = 1; n <= 5; n++) {
        await logIn().expect(201);
      }

      const refused = await logIn().expect(429);

      expect(refused.headers['retry-after']).toBe('600');
      expect(refused.body.message).toBe(
        'Too many login attempts. Please try again later.',
      );
    });

    it('runs only the otp throttler', async () => {
      const accepted = await logIn().expect(201);

      expect(accepted.headers['x-ratelimit-limit-otp']).toBe('5');
      expect(accepted.headers).not.toHaveProperty('x-ratelimit-limit');
    });
  });
});
