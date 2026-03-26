import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CaseStatus } from '../type/cases.type';

@Entity('cases')
export class Case extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  title!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ enum: CaseStatus, default: CaseStatus.DRAFT })
  status!: CaseStatus;

  @Column({ default: false })
  isGlobal!: boolean;

  @Column({ type: 'int', default: 0 })
  totalScenarios!: number;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;
}
