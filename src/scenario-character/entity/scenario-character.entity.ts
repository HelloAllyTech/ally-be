import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('scenario_characters')
export class ScenarioCharacter extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_scenario_character_name')
  @Column()
  name!: string;

  @Column({ type: 'int' })
  age!: number;

  @Column()
  gender!: string;

  @Column({ nullable: true })
  profession?: string;

  @Column({ name: 'current_location' })
  currentLocation!: string;

  @Column({ name: 'gender_identity' })
  genderIdentity!: string;

  @Column({ name: 'sexual_orientation' })
  sexualOrientation!: string;

  @Column({ name: 'created_by' })
  createdBy!: number;

  @Column({ name: 'updated_by' })
  updatedBy!: number;
}
