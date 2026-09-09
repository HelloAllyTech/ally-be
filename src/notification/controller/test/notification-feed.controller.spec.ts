import { Test, TestingModule } from '@nestjs/testing';
import { NotificationFeedController } from '../notification-feed.controller';
import { InAppNotificationService } from '../../service/in-app-notification.service';
import { DeviceTokenService } from '../../service/device-token.service';
import { DevicePlatform } from '../../type/device-platform.enum';

describe('NotificationFeedController', () => {
  let controller: NotificationFeedController;
  let notificationService: Partial<
    Record<keyof InAppNotificationService, jest.Mock>
  >;
  let deviceTokenService: Partial<
    Record<keyof DeviceTokenService, jest.Mock>
  >;

  const user = { id: 42, username: 'alice', tenantId: 'tenant-1' };

  beforeEach(async () => {
    notificationService = {
      list: jest.fn().mockResolvedValue({ data: [], count: 0 }),
      unreadCount: jest.fn().mockResolvedValue(0),
      markRead: jest.fn().mockResolvedValue(true),
      markAllRead: jest.fn().mockResolvedValue(true),
    };
    deviceTokenService = {
      register: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationFeedController],
      providers: [
        { provide: InAppNotificationService, useValue: notificationService },
        { provide: DeviceTokenService, useValue: deviceTokenService },
      ],
    }).compile();

    controller = module.get(NotificationFeedController);
  });

  it('scopes list() to the caller', async () => {
    await controller.list(user as any, { limit: 10, offset: 5 } as any);

    expect(notificationService.list).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ limit: 10, offset: 5 }),
    );
  });

  it('scopes markRead() to the caller and the given id', async () => {
    await controller.markRead(user as any, 'notif-1');

    expect(notificationService.markRead).toHaveBeenCalledWith(42, 'notif-1');
  });

  it('scopes markAllRead() to the caller', async () => {
    await controller.markAllRead(user as any);

    expect(notificationService.markAllRead).toHaveBeenCalledWith(42);
  });

  it("registers a device token against the caller's own id and tenant", async () => {
    await controller.registerDeviceToken(user as any, {
      token: 'fcm-token',
      platform: DevicePlatform.ANDROID,
    });

    expect(deviceTokenService.register).toHaveBeenCalledWith(
      42,
      'tenant-1',
      'fcm-token',
      DevicePlatform.ANDROID,
    );
  });

  it("deletes a device token scoped to the caller's own id", async () => {
    await controller.deleteDeviceToken(user as any, 'fcm-token');

    expect(deviceTokenService.remove).toHaveBeenCalledWith(42, 'fcm-token');
  });
});
