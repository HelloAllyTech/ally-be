import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('trigger_warnings')
export class TriggerWarnings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;
}
