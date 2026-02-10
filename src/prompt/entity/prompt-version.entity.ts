import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prompts_versions')
@Index('uq_prompts_versions_idx', ['promptId', 'version'], { unique: true })
@Index('prompts_versions_promptId_idx', ['promptId'])
export class PromptVersion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  promptId!: string;

  @Column()
  version!: number;

  @Column()
  prompt!: string;

  @Column()
  createdBy?: number;

  @Column()
  updatedBy?: number;
}
