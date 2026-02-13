import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BaseEntity,
  Index,
} from 'typeorm';

@Entity('auth_attempts')
@Index('uniq_active_auth_attempt', ['email'], {
  where: 'used = false',
  unique: true,
})
export class AuthAttempt extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column({ name: 'otp_hash' })
  otpHash!: string;

  @Column({ name: 'magic_token_hash' })
  magicTokenHash!: string;

  @Column({ name: 'expires_at' })
  expiresAt!: Date;

  @Column({ default: false })
  used!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'used_at', nullable: true })
  usedAt?: Date;
}
