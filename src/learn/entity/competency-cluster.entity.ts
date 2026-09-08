import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A named grouping of competencies — typically a framework the customer
 * already trains against. Clusters are created by admins; none ship with the
 * platform.
 *
 * Membership is many-to-many (see CompetencyClusterMember): an admin decides
 * how their frameworks overlap, so nothing here stops one competency from
 * sitting in several clusters.
 *
 * A cluster is an AUTHORING grouping only. Selecting one in the simulation
 * builder expands to its member competencies and the scenario stores those
 * ids — it never stores the cluster, so re-clustering later cannot silently
 * change what an already-published simulation assesses.
 */
@Entity('competency_clusters')
export class CompetencyCluster extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  createdBy?: number;
}
