import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BaseEntity,
  Index,
} from 'typeorm';

@Entity()
export class RefreshToken extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * SHA-256 hex of the whole refresh token. Rows written before
   * `RefreshTokenExactRotation1974000000000` hold a bcrypt hash instead
   * (`$2…`), which matches any token of the same user — see
   * `AuthService.findRefreshTokenRow`.
   */
  @Column()
  token!: string;

  /** When this token was exchanged. It stays valid for a short grace window after. */
  @Column({ type: 'timestamp', nullable: true })
  rotatedAt?: Date | null;

  @Column()
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @Index('IDX_refresh_token_userId')
  @Column()
  userId!: number;

  @Column({ nullable: true })
  deviceInfo?: string;
}
