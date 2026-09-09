import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { EngagementReminderEvaluatorService } from '../engagement-reminder-evaluator.service';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { DeviceTokenService } from 'src/notification/service/device-token.service';
import { PushService } from 'src/notification/service/push.service';
import {
  ENGAGEMENT_REMINDER_TYPE,
  INACTIVITY_DAYS_THRESHOLD,
  REMINDER_COOLDOWN_DAYS,
} from '../../constant/engagement-reminder.constant';

describe('EngagementReminderEvaluatorService', () => {
  let service: EngagementReminderEvaluatorService;
  let dataSource: { query: jest.Mock };
  let notificationService: { create: jest.Mock };
  let deviceTokenService: { getTokensForUser: jest.Mock };
  let pushService: { sendDataMessage: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    notificationService = { create: jest.fn().mockResolvedValue({}) };
    deviceTokenService = { getTokensForUser: jest.fn().mockResolvedValue([]) };
    pushService = { sendDataMessage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementReminderEvaluatorService,
        { provide: DataSource, useValue: dataSource },
        { provide: InAppNotificationService, useValue: notificationService },
        { provide: DeviceTokenService, useValue: deviceTokenService },
        { provide: PushService, useValue: pushService },
      ],
    }).compile();

    service = module.get(EngagementReminderEvaluatorService);
  });

  describe('tenant opt-in', () => {
    it('does nothing when no tenant has opted in', async () => {
      dataSource.query.mockResolvedValueOnce([]); // opted-in tenants

      await service.evaluate();

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(notificationService.create).not.toHaveBeenCalled();
    });

    it('requires an explicit true rather than defaulting on', async () => {
      await service.evaluate();

      const [sql] = dataSource.query.mock.calls[0];
      expect(sql).toContain("'engagementReminder'");
      expect(sql).toContain("'remindersEnabled'");
      expect(sql).toContain('COALESCE');
      expect(sql).toContain("'false'");
    });
  });

  describe('eligibility query', () => {
    it('scopes to the tenant, the inactivity threshold and the cooldown', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([]);

      await service.evaluate();

      const [sql, params] = dataSource.query.mock.calls[1];
      expect(params).toEqual([
        'tenant-1',
        INACTIVITY_DAYS_THRESHOLD,
        ENGAGEMENT_REMINDER_TYPE,
        REMINDER_COOLDOWN_DAYS,
      ]);
      expect(sql).toContain('COALESCE(u."lastActiveAt", u."createdAt")');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('in_app_notifications');
    });
  });

  describe('sending', () => {
    const learner = (userId: number) => ({ userId });

    it('creates an in-app notification for each eligible learner', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([learner(1), learner(2)]);

      await service.evaluate();

      expect(notificationService.create).toHaveBeenCalledTimes(2);
      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          tenantId: 'tenant-1',
          type: ENGAGEMENT_REMINDER_TYPE,
        }),
      );
    });

    it('sends push only to learners with a registered device token', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([learner(1), learner(2)]);
      deviceTokenService.getTokensForUser
        .mockResolvedValueOnce(['token-1'])
        .mockResolvedValueOnce([]);

      await service.evaluate();

      expect(pushService.sendDataMessage).toHaveBeenCalledTimes(1);
      expect(pushService.sendDataMessage).toHaveBeenCalledWith(
        ['token-1'],
        expect.objectContaining({ type: ENGAGEMENT_REMINDER_TYPE }),
      );
    });

    it('still creates the notification when push fails', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([learner(1)]);
      deviceTokenService.getTokensForUser.mockResolvedValueOnce(['token-1']);
      pushService.sendDataMessage.mockRejectedValueOnce(new Error('FCM down'));

      await expect(service.evaluate()).resolves.not.toThrow();
      expect(notificationService.create).toHaveBeenCalledTimes(1);
    });

    it('keeps going when one tenant errors', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }, { id: 'tenant-2' }])
        .mockRejectedValueOnce(new Error('query failed'))
        .mockResolvedValueOnce([learner(1)]);

      await expect(service.evaluate()).resolves.not.toThrow();
      expect(notificationService.create).toHaveBeenCalledTimes(1);
    });

    it('keeps going when one learner errors', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'tenant-1' }])
        .mockResolvedValueOnce([learner(1), learner(2)]);
      notificationService.create
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce({});

      await expect(service.evaluate()).resolves.not.toThrow();
      expect(notificationService.create).toHaveBeenCalledTimes(2);
    });
  });
});
