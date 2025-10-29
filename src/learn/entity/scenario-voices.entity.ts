import { BaseWithoutTenantEntity } from 'src/common/entities/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class ScenarioVoices extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  provider!: string;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, any>;
}
