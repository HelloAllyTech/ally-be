import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BaseEntity,
  Index,
} from 'typeorm';

@Entity('auth_attempts')
@Index('uq_auth_attempts_email_idx', ['email'], {
  where: 'used = false',
  unique: true,
})
export class AuthAttempt extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column()
  otpHash!: string;

  @Column()
  magicTokenHash!: string;

  @Column()
  expiresAt!: Date;

  @Column({ default: false })
  used!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ nullable: true })
  usedAt?: Date;
}
