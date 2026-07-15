import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * A superadmin-uploaded comfort-audio track — a real audio file (ambient
 * room-tone / background sound) that a scenario author can select as the
 * comfort audio for a roleplay. System-wide (no tenant): one shared library
 * every org's authors pick from. Mirrors ScenarioCoverImageLibrary.
 */
@Entity('comfort_audio_tracks')
export class ComfortAudioTrack extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_comfort_audio_tracks_name')
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', name: 'audio_url' })
  audioUrl!: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'content_type',
    nullable: true,
  })
  contentType?: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes?: number | null;

  /**
   * When set, the track is archived: it can no longer be newly selected as the
   * comfort audio for a roleplay, but it keeps working for scenarios that
   * already reference its URL. Null = active. Archiving is reversible.
   */
  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
