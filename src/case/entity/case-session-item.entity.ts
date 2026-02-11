import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { SessionItemStatus } from 'src/common/type/common.type';

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  DeleteDateColumn,
} from 'typeorm';

@Entity('case_session_items')
export class CaseSessionItem extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  caseSessionId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  caseItemId!: string;

  @Column({
    enum: SessionItemStatus,
    default: SessionItemStatus.UNLOCKED,
  })
  status!: SessionItemStatus;

  @DeleteDateColumn()
  deletedAt?: Date;
}
