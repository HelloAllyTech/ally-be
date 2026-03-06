import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prompts')
@Index('uq_prompts_name_idx', ['name'], { unique: true })
@Index('uq_prompts_code_idx', ['promptCode'], { unique: true })
export class Prompt extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  promptCode!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column({ nullable: true })
  currentVersion?: number;

  @Column({ type: 'text', nullable: true })
  defaultPrompt?: string;

  @Column({ type: 'boolean', default: false })
  useDashboardOverride!: boolean;
}
