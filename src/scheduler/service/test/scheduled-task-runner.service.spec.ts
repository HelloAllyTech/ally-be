import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ScheduledTaskRunnerService } from '../scheduled-task-runner.service';
import { scheduledTaskRegistry } from '../../registry/scheduled-task.registry';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe('ScheduledTaskRunnerService — leader guard', () => {
  let service: ScheduledTaskRunnerService;
  let query: jest.Mock;
  let release: jest.Mock;

  const buildRunner = (locked: boolean) => {
    query = jest.fn((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([{ pg_advisory_unlock: true }]);
    });
    release = jest.fn().mockResolvedValue(undefined);
    return {
      connect: jest.fn().mockResolvedValue(undefined),
      query,
      release,
    };
  };

  const setup = async (locked: boolean) => {
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(buildRunner(locked)),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledTaskRunnerService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ScheduledTaskRunnerService);
  };

  afterEach(() => {
    jest.restoreAllMocks();
    // Clear anything the tests registered.
    (scheduledTaskRegistry as any).handlers?.clear?.();
  });

  it('runs the interval tasks and releases the lock when it wins the lock', async () => {
    await setup(true);
    const handler = jest.fn().mockResolvedValue(undefined);
    scheduledTaskRegistry.register('hourly', 'test-task', handler);

    await service.runHourlyTasks();

    expect(handler).toHaveBeenCalledTimes(1);
    // Acquired + released.
    expect(
      query.mock.calls.some((c) => c[0].includes('pg_advisory_unlock')),
    ).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips the tasks (but still releases the runner) when another replica holds the lock', async () => {
    await setup(false);
    const handler = jest.fn().mockResolvedValue(undefined);
    scheduledTaskRegistry.register('hourly', 'test-task-2', handler);

    await service.runHourlyTasks();

    expect(handler).not.toHaveBeenCalled();
    // Never unlocks something it didn't acquire, but always releases the runner.
    expect(
      query.mock.calls.some((c) => c[0].includes('pg_advisory_unlock')),
    ).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not touch the DB when the interval has no registered tasks', async () => {
    await setup(true);
    const createQueryRunner = (service as any).dataSource.createQueryRunner;

    await service.runFiveMinuteTasks();

    expect(createQueryRunner).not.toHaveBeenCalled();
  });
});
