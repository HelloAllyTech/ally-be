import { UserRole, UserStatus } from '../constants/user.constants';
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('users')
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
  role!: UserRole;

  @Column()
  status!: UserStatus;

  @Column({ unique: true })
  username!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'text', nullable: true, unique: true })
  phone?: string;
}
