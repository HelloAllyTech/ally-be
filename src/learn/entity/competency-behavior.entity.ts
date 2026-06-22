import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { CompetencyBehaviorType } from '../enum/competency-behavior.enum';

/**
 * Join table mapping a competency to the behaviours that count as helpful or
 * unhelpful for it. `behaviorId` references the shared `behaviors` library.
 */
@Entity('competency_behaviors')
@Unique(['competencyId', 'behaviorId'])
export class CompetencyBehavior extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  competencyId!: string;

  @Column({ type: 'uuid' })
  behaviorId!: string;

  // 'HELPFUL' | 'UNHELPFUL' — stored as plain varchar to avoid a pg enum type.
  @Column()
  type!: CompetencyBehaviorType;
}
