import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { AppConfigService } from '../../../config/config.service';
import { RedisService } from '../../../redis/service/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let db: jest.Mocked<TypeOrmHealthIndicator>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn((checks: Array<() => Promise<unknown>>) =>
              Promise.all(checks.map((check) => check())),
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
  });

  it('pings the database with the same deadline documented and used for the other checks, not terminus default 1s', async () => {
    await controller.check();

    expect(db.pingCheck).toHaveBeenCalledWith('ally_test', { timeout: 2000 });
  });
});
