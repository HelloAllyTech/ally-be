import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import { RedisService } from '../../redis/service/redis.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Per-dependency deadline. The whole endpoint must answer well inside a load
 * balancer's probe timeout, and the checks below run in parallel, so this is
 * also roughly the endpoint's worst-case latency.
 */
const CHECK_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  private readonly logger = LoggerService.getInstance(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private configService: AppConfigService,
    private db: TypeOrmHealthIndicator,
    private redis: RedisService,
  ) {}

  /**
   * GET /api/health
   *
   * WHAT THIS ENDPOINT IS FOR, and why the two groups below are treated
   * differently:
   *
   * It used to ping Postgres and nothing else, which made it a check that could
   * essentially not fail — the app is unusable without Redis (sessions, the
   * permission cache, rate limiting, the scheduler's advisory locks all live
   * there) and most of its interesting surfaces are unusable without ally-ai,
   * and the endpoint reported a cheerful 200 through an outage of either.
   *
   * HARD dependencies — Postgres, Redis — fail the check. A replica that cannot
   * reach them cannot serve, so 503 is correct and the load balancer should pull
   * it out of rotation.
   *
   * SOFT dependencies — ally-ai, ally-ai-learn — are reported but do NOT fail
   * the check, and that asymmetry is deliberate. They are separate services with
   * their own availability; if their outage returned 503 here, every ally-be
   * replica would be marked unhealthy at once and pulled from rotation, turning
   * a degraded feature into a total outage of the login, scribe and admin
   * surfaces that never needed them. Their state surfaces as
   * `degraded: true` plus a reason, which is what a dashboard should page on.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck(this.configService.database.database as string),
      () => this.checkRedis(),
      () =>
        this.checkAiService(
          'ally-ai',
          this.configService.ai.apiUrl,
          '/api/health',
        ),
      () =>
        this.checkAiService(
          'ally-ai-learn',
          this.configService.ai.learnApiUrl,
          '/api/health',
        ),
    ]);
  }

  /** HARD dependency: a failure here fails the whole check. */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    const startedAt = Date.now();
    try {
      await this.redis.ping(CHECK_TIMEOUT_MS);
      return {
        redis: { status: 'up', responseTimeMs: Date.now() - startedAt },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Health check: Redis is unreachable — ${reason}`);
      // Terminus turns a `down` indicator into a 503 for the whole endpoint,
      // which is the intent: this replica cannot serve.
      return {
        redis: {
          status: 'down',
          responseTimeMs: Date.now() - startedAt,
          reason,
        },
      };
    }
  }

  /**
   * SOFT dependency: always reports `status: 'up'` so it cannot 503 the
   * endpoint, and carries `degraded` + `reason` when the service is not
   * answering. An unconfigured URL is reported as `configured: false` rather
   * than as a failure — a deployment without the AI services is a valid
   * deployment, not a broken one.
   */
  private async checkAiService(
    key: string,
    baseUrl: string | undefined,
    healthPath: string,
  ): Promise<HealthIndicatorResult> {
    if (!baseUrl) {
      return { [key]: { status: 'up', configured: false } };
    }

    const startedAt = Date.now();
    try {
      const response = await axios.get(
        `${baseUrl.replace(/\/$/, '')}${healthPath}`,
        {
          timeout: CHECK_TIMEOUT_MS,
          // Any 2xx/3xx counts as reachable; the status is reported either way,
          // so a 404 on the health path shows up as degraded-with-a-reason
          // rather than as an exception with no detail.
          validateStatus: () => true,
        },
      );
      const reachable = response.status >= 200 && response.status < 400;
      return {
        [key]: {
          status: 'up',
          configured: true,
          ...(reachable
            ? {}
            : {
                degraded: true,
                reason: `${key} answered HTTP ${response.status}`,
              }),
          upstreamStatus: response.status,
          responseTimeMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Health check: ${key} is not answering — ${reason}. Reported as ` +
          `degraded, NOT as a failure: this replica can still serve everything ` +
          `that does not need ${key}.`,
      );
      return {
        [key]: {
          status: 'up',
          configured: true,
          degraded: true,
          reason,
          responseTimeMs: Date.now() - startedAt,
        },
      };
    }
  }
}
