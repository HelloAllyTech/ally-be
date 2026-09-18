import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDeviceToken } from '../entity/user-device-token.entity';
import { DevicePlatform } from '../type/device-platform.enum';

@Injectable()
export class DeviceTokenService {
  constructor(
    @InjectRepository(UserDeviceToken)
    private readonly deviceTokenRepository: Repository<UserDeviceToken>,
  ) {}

  /**
   * Upsert on `token`, not (userId, token): the same physical device can be
   * re-registered by a different user (shared device, or logout/login as
   * someone else), and a token row must always point at whoever is currently
   * logged in on that device rather than accumulate stale duplicates.
   */
  async register(
    userId: number,
    tenantId: string,
    token: string,
    platform: DevicePlatform,
  ): Promise<void> {
    const existing = await this.deviceTokenRepository.findOne({
      where: { token },
    });
    if (existing) {
      existing.userId = userId;
      existing.tenantId = tenantId;
      existing.platform = platform;
      await this.deviceTokenRepository.save(existing);
      return;
    }
    await this.deviceTokenRepository.save(
      this.deviceTokenRepository.create({ userId, tenantId, token, platform }),
    );
  }

  /** Scoped to `userId` so a caller can only unregister their own device. */
  async remove(userId: number, token: string): Promise<void> {
    await this.deviceTokenRepository.delete({ userId, token });
  }

  /** Unscoped removal used by PushService when FCM reports a token as dead. */
  async deleteToken(token: string): Promise<void> {
    await this.deviceTokenRepository.delete({ token });
  }

  async getTokensForUser(userId: number): Promise<string[]> {
    const rows = await this.deviceTokenRepository.find({
      where: { userId },
      select: ['token'],
    });
    return rows.map((row) => row.token);
  }
}
