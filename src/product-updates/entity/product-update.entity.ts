import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  EditableUpdateField,
  UPDATE_AUDIENCES,
  UPDATE_KINDS,
  UpdateAudience,
  UpdateKind,
  UpdateSurface,
} from '../constants/product-update.constants';
import { ProductUpdateSource } from './product-update-source.entity';

/**
 * One change to Ally that a person would recognise as one thing — the unit of
 * the public changelog and of the team's daily digest.
 *
 * Built from one or more merges (`ProductUpdateSource`) across any number of
 * repos, and written by exactly one writer: the consolidation job. A person
 * can correct any field from the admin console, and a corrected field is
 * recorded in `editedFields` so the job never overwrites it — the property the
 * old per-merge feed lacked, and the reason it was unfixable in public.
 *
 * Platform-wide, not tenant-scoped: Ally's changelog is one list.
 *
 * Public means `audience = public`, `liveAt` set and `hidden = false`. There is
 * no approval state on purpose — publishing is fully automatic (decided
 * 2026-09-30) and `hidden` is how a wrong call is withdrawn.
 */
@Entity('product_updates')
@Index('idx_product_updates_live_at', ['liveAt'])
export class ProductUpdate extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stable, human-readable anchor for the public page: `2026-09-30-voice-roleplay-pauses`. */
  @Index('uq_product_updates_slug', {
    unique: true,
    where: '"deletedAt" IS NULL',
  })
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text' })
  summary!: string;

  /** Markdown bullets for Ally's team: why, where, how to turn it on. Never public. */
  @Column({ name: 'team_notes', type: 'text', default: '' })
  teamNotes!: string;

  @Column({ type: 'varchar', length: 16, enum: UPDATE_KINDS })
  kind!: UpdateKind;

  @Column({ type: 'varchar', length: 16, enum: UPDATE_AUDIENCES })
  audience!: UpdateAudience;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  surfaces!: UpdateSurface[];

  @Column({ type: 'varchar', length: 40 })
  area!: string;

  /** The model's confidence in the audience and the text, 0–1. Low values are flagged in the digest. */
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    default: 0.5,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  confidence!: number;

  /** Withdrawn from the public page by a person. The update is kept, so its merges stay accounted for. */
  @Column({ type: 'boolean', default: false })
  hidden!: boolean;

  /** Fields a person has changed. The consolidation job never writes these again. */
  @Column({
    name: 'edited_fields',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  editedFields!: EditableUpdateField[];

  @Column({ name: 'edited_by', type: 'int', nullable: true })
  editedBy!: number | null;

  @Column({ name: 'edited_at', type: 'timestamp', nullable: true })
  editedAt!: Date | null;

  /** Event time: the earliest and latest merge behind this update. */
  @Column({ name: 'first_merged_at', type: 'timestamp' })
  firstMergedAt!: Date;

  @Column({ name: 'last_merged_at', type: 'timestamp' })
  lastMergedAt!: Date;

  /** When the last change it waits on reached production. Null while any is unreleased. */
  @Column({ name: 'live_at', type: 'timestamp', nullable: true })
  liveAt!: Date | null;

  /** When it first appeared on the public page. Only ever set for public updates. */
  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt!: Date | null;

  /** When a team digest last reported this update's state, so a digest never repeats itself. */
  @Column({ name: 'announced_at', type: 'timestamp', nullable: true })
  announcedAt!: Date | null;

  /** Whether the digest has already reported this update as live (vs. only as merged). */
  @Column({ name: 'announced_live', type: 'boolean', default: false })
  announcedLive!: boolean;

  /** Which model wrote the current text, for tracing a bad line back. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  /** The model's one-sentence reason for its last decision about this update. */
  @Column({ name: 'decision_reason', type: 'text', nullable: true })
  decisionReason!: string | null;

  @OneToMany(() => ProductUpdateSource, (source) => source.update)
  sources?: ProductUpdateSource[];

  @DeleteDateColumn()
  deletedAt?: Date | null;
}
