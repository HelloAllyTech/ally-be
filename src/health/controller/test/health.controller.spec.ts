import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { AppConfigService } from '../../../config/config.service';
import { RedisService } from '../../../redis/service/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let db: jest.Mocked<TypeOrmHealthIndicator>;
  let module: TestingModule;
  let redis: RedisService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(
              async (
                checks: Array<() => Promise<HealthIndicatorResult>>,
              ): Promise<HealthCheckResult> => {
                const results = await Promise.all(
                  checks.map((check) => check()),
                );
                const combinedInfo: HealthIndicatorResult = {};
                const combinedError: HealthIndicatorResult = {};
                let isOk = true;

                for (const result of results) {
                  for (const key in result) {
                    if (result[key].status === 'down') {
                      isOk = false;
                      combinedError[key] = result[key];
                    }
                    combinedInfo[key] = result[key];
                  }
                }

                return {
                  status: isOk ? 'ok' : 'error',
                  info: combinedInfo,
                  error: combinedError,
                  details: combinedInfo,
                };
              },
            ),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            database: { database: 'ally_test' },
            ai: { apiUrl: undefined, learnApiUrl: undefined },
          },
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: {
            pingCheck: jest
              .fn()
              .mockResolvedValue({ ally_test: { status: 'up' } }),
          },
        },
        {
          provide: RedisService,
          useValue: { ping: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    db = module.get(TypeOrmHealthIndicator);
    redis = module.get(RedisService);
  });

  it('pings the database with the same deadline documented and used for the other checks, not terminus default 1s', async () => {
    await controller.check();

    expect(db.pingCheck).toHaveBeenCalledWith('ally_test', { timeout: 2000 });
  });

  it('passes a redis check that fails once, then passes', async () => {
    (redis.ping as jest.Mock)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);

    const health = await controller.check();

    expect(health.info?.redis?.status).toBe('up');
  });

  it('fails a redis check that fails twice', async () => {
    (redis.ping as jest.Mock)
      .mockRejectedValue(new Error('timeout'))
      .mockRejectedValue(new Error('timeout'));

    const health = await controller.check();

    expect(health.info?.redis?.status).toBe('down');
  });

  it('returns the second error when redis check fails twice', async () => {
    const firstError = new Error('First timeout');
    const secondError = new Error('Second timeout');
    (redis.ping as jest.Mock)
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(secondError);

    const health = await controller.check();

    expect(health.info?.redis?.status).toBe('down');
    expect(health.error?.redis?.reason).toBe('Second timeout');
  });
});
