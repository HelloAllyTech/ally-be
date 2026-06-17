import { UserStatus } from '../constants/user-status.constants';
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

@Entity('users')
@Index(['tenantId', 'externalId'], {
  unique: true,
  where: '"externalId" IS NOT NULL',
})
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  email!: string;

  @Column({ select: false, nullable: true })
  password?: string;

  @Column()
  name!: string;

  @Column()
  status!: UserStatus;

  // False for accounts created in bulk by an admin (name left blank); the user
  // is prompted to fill in remaining fields on first login. Defaults true so
  // every pre-existing / individually-created account is treated as complete.
  @Column({ type: 'boolean', default: true })
  profileCompleted!: boolean;

  @Column({ unique: true })
  username!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'text', nullable: true, unique: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  externalId?: string;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @Column({ nullable: true })
  suspendedBy?: number;

  @Column({ nullable: true })
  suspendedAt?: Date;

  @Column({ type: 'boolean', default: false })
  termsAndAgreementApproved!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  termsAndAgreementApprovedAt?: Date;

  @Column({ nullable: true })
  profileImageUrl?: string;
}
