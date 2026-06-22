import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('competencies')
export class Competency extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  // User-owned "custom" competencies are created on the fly when a scenario's
  // behaviour selections diverge from a defined competency's mapping. They are
  // scoped to their owner (`createdBy`) and hidden from the global competency
  // list (superadmin "Competencies" tab); only the owner sees them in the
  // simulation builder dropdown.
  @Column({ default: false })
  isCustom!: boolean;

  @Column({ nullable: true })
  createdBy?: number;
}
