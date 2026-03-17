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

  @Column({ name: 'cover_image_url', nullable: true })
  coverImageUrl?: string;

  @Column({ name: 'cover_video_url', nullable: true })
  coverVideoUrl?: string;

  @Column({
    name: 'character_profile_text',
    type: 'varchar',
    length: 2500,
    nullable: true,
  })
  characterProfileText?: string;

  @Column({ name: 'created_by' })
  createdBy!: number;

  @Column({ name: 'updated_by' })
  updatedBy!: number;
}
