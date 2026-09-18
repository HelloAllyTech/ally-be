import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Join table placing a competency in a cluster. Deliberately many-to-many:
 * a competency may belong to any number of clusters.
 */
@Entity('competency_cluster_members')
@Unique(['clusterId', 'competencyId'])
export class CompetencyClusterMember extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  clusterId!: string;

  @Index()
  @Column({ type: 'uuid' })
  competencyId!: string;
}
