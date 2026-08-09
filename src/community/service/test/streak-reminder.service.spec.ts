import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { StreakReminderService } from '../streak-reminder.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SESService } from 'src/aws/service/ses.service';
import { AppConfigService } from 'src/config/config.service';

describe('StreakReminderService', () => {
  let service: StreakReminderService;
  let dataSource: { query: jest.Mock };
  let redisService: { acquireLock: jest.Mock };
  let sesService: { sendEmail: jest.Mock };

  /** 14:30 UTC is 20:00 IST — inside the reminder hour. */
  const INSIDE_WINDOW = '2026-08-09T14:30:00.000Z';
  /** 20:00 UTC is 01:30 IST the next day — outside it. */
  const OUTSIDE_WINDOW = '2026-08-09T20:00:00.000Z';

  const atTime = (iso: string) => {
    jest.useFakeTimers().setSystemTime(new Date(iso));
  };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    redisService = { acquireLock: jest.fn().mockResolvedValue(true) };
    sesService = { sendEmail: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreakReminderService,
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redisService },
        { provide: SESService, useValue: sesService },
        {
          provide: AppConfigService,
          useValue: { email: { sourceEmail: 'no-reply@example.com' } },
        },
      ],
    }).compile();

    service = module.get<StreakReminderService>(StreakReminderService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('the send window', () => {
    it('does nothing outside the reminder hour', async () => {
      atTime(OUTSIDE_WINDOW);

      await service.sendAtRiskReminders();

      expect(redisService.acquireLock).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('runs when the business-timezone hour matches, whatever the container timezone is', async () => {
      // 14:30 UTC is not 20:00 anywhere in UTC terms — this only proceeds
      // because the gate converts to the business timezone from the absolute
      // instant, so it is immune to the container's TZ (which this repo never
      // sets).
      atTime(INSIDE_WINDOW);

      await service.sendAtRiskReminders();

      expect(redisService.acquireLock).toHaveBeenCalled();
    });
  });

  describe('the once-per-day lock', () => {
    it('takes a lock keyed on the business date', async () => {
      atTime(INSIDE_WINDOW);

      await service.sendAtRiskReminders();

      expect(redisService.acquireLock).toHaveBeenCalledWith(
        'streak-reminder:2026-08-09',
        6 * 60 * 60,
      );
    });

    it('stops when another run already holds the lock', async () => {
      atTime(INSIDE_WINDOW);
      redisService.acquireLock.mockResolvedValue(false);

      await service.sendAtRiskReminders();

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(sesService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('tenant opt-in', () => {
    it('sends nothing when no tenant has opted in', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query.mockResolvedValueOnce([]); // opted-in tenants

      await service.sendAtRiskReminders();

      // Only the tenant lookup ran; no recipient query, no email.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(sesService.sendEmail).not.toHaveBeenCalled();
    });

    it('requires an explicit true rather than defaulting on', async () => {
      atTime(INSIDE_WINDOW);

      await service.sendAtRiskReminders();

      const [sql] = dataSource.query.mock.calls[0];
      expect(sql).toContain("'remindersEnabled'");
      expect(sql).toContain('COALESCE');
      expect(sql).toContain("'false'");
    });
  });

  describe('sending', () => {
    const recipient = (userId: number, currentStreak = 4) => ({
      userId,
      email: `learner${userId}@example.com`,
      name: `Learner ${userId}`,
      currentStreak,
    });

    it('emails each at-risk learner once', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([recipient(1), recipient(2)]);

      await service.sendAtRiskReminders();

      expect(sesService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it('quotes the streak length and the real one-minute rule', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([recipient(1, 6)]);

      await service.sendAtRiskReminders();

      const [params] = sesService.sendEmail.mock.calls[0];
      expect(params.subject).toContain('6-day practice streak');
      // Must agree with every other streak surface — a reminder that quoted a
      // different threshold than the app would be the thing users distrust.
      expect(params.body).toContain('a minute or more');
      expect(params.body).toContain('Learner 1');
      expect(params.to).toBe('learner1@example.com');
    });

    it('mentions how to turn the reminders off', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([recipient(1)]);

      await service.sendAtRiskReminders();

      expect(sesService.sendEmail.mock.calls[0][0].body).toMatch(
        /turn these reminders off/i,
      );
    });

    it('keeps going when one recipient fails to send', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([recipient(1), recipient(2)]);
      sesService.sendEmail
        .mockRejectedValueOnce(new Error('SES throttled'))
        .mockResolvedValueOnce(true);

      await expect(service.sendAtRiskReminders()).resolves.not.toThrow();
      expect(sesService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it('keeps going when one tenant errors', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }, { id: 'tenant-2' }])
        .mockRejectedValueOnce(new Error('query failed'))
        .mockResolvedValueOnce([recipient(1)]);

      await expect(service.sendAtRiskReminders()).resolves.not.toThrow();
      expect(sesService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('scopes the recipient query to the tenant and the business date', async () => {
      atTime(INSIDE_WINDOW);
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([]);

      await service.sendAtRiskReminders();

      const [sql, params] = dataSource.query.mock.calls[1];
      expect(params).toEqual(['tenant-1', '2026-08-09', 2]);
      // Already-practised users are excluded by construction, not filtered after.
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('"minutesPlayed" >= 1.00');
      // At-risk, not already-broken.
      expect(sql).toContain('last_day >= $2::date - 1');
      expect(sql).not.toContain('CURRENT_DATE');
    });
  });
});
