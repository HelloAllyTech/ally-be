import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  eventType!: string;

  @Column({ nullable: true })
  userId!: number;

  @Column({ nullable: true })
  tenantId!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, any>;

  @Column({ nullable: true })
  ipAddress!: string;

  @Column({ nullable: true })
  userAgent!: string;

  @CreateDateColumn()
  loggedAt!: Date;
}
