import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import { CharacterKnowledgeSource } from '../type/character-knowledge-source.type';

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

  // Loose FK to scenario_voices.id (no DB constraint, matching repo
  // convention — see Scenario.roleplaySpecId). Null if this character has
  // no assigned voice.
  @Column({ name: 'voice_id', type: 'uuid', nullable: true })
  voiceId?: string;

  @Column({
    name: 'language_characteristics',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  languageCharacteristics?: string;

  @Column({
    name: 'linguistic_style_samples',
    type: 'jsonb',
    nullable: true,
  })
  linguisticStyleSamples?: string[];

  @Column({ name: 'knowledge_sources', type: 'jsonb', nullable: true })
  knowledgeSources?: CharacterKnowledgeSource[];

  /**
   * Owning tenant, or NULL for an Ally-owned character visible to every
   * platform admin and to nobody else. A tenant admin's characters are stamped
   * with their tenant and are readable only within it — see
   * ScenarioCharacterRepository.getScenarioCharactersQuery. Deliberately not on
   * BaseEntity (which makes tenant_id NOT NULL): the global rows need NULL.
   */
  @Index('idx_scenario_characters_tenant_id')
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'created_by' })
  createdBy!: number;

  @Column({ name: 'updated_by' })
  updatedBy!: number;
}
