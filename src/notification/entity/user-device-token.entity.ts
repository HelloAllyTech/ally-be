import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { DevicePlatform } from '../type/device-platform.enum';

/**
 * One row per (user, device) FCM registration token. A user can hold several
 * (multiple devices); a token is deleted on logout (client calls
 * `DELETE /v1/notifications/device-tokens/:token`) or self-cleaned by
 * `PushService` when FCM reports it as no-longer-registered.
 */
@Entity('user_device_tokens')
export class UserDeviceToken extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'text', unique: true })
  token!: string;

  @Column({ type: 'varchar', length: 10, enum: DevicePlatform })
  platform!: DevicePlatform;
}
