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

  @Column({ unique: true })
  username!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'text', nullable: true, unique: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  externalId?: string;
}
