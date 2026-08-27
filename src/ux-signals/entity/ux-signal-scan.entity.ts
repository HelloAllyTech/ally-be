import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  UxSignalScanStatus,
  UxSignalScanTrigger,
} from '../enum/ux-signal.enum';

/**
 * One UX Signals scan — the run log for "we read PostHog and filed what we found".
 *
 * The CHECK constraints and indexes live in migration 1940200000000 only;
 * `migration:generate` would propose dropping them. Never generate migrations
 * against this table.
 *
 * Three jobs, and every column serves one of them:
 *
 *  - **The daily gate.** The scheduler ticks hourly (there is no daily tick) and
 *    self-gates on the newest non-running row's `startedAt`. That timestamp has
 *    to be durable, so the cadence survives a redeploy; an in-memory last-run
 *    marker would let every restart re-scan.
 *  - **The concurrency guard.** A RUNNING row younger than the stale threshold
 *    blocks a second scan, so the hourly tick cannot overlap a slow PostHog
 *    query or a manual "Scan now" pressed mid-run.
 *  - **Telling a human what happened.** The counts are what the Scan-now toast
 *    reports. `skippedDuplicates` is deliberately its own number rather than
 *    folded into `signalsDetected`: a scan that detected nine signals and filed
 *    nothing because all nine were already open is working correctly, and it
 *    must not read as a scan that found nothing.
 *
 * No soft delete and no tenant: a scan is platform-wide by nature (PostHog is
 * not tenant-partitioned) and the log is append-only history.
 */
@Entity('ux_signal_scans')
export class UxSignalScan extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ enum: UxSignalScanTrigger })
  trigger!: UxSignalScanTrigger;

  @Column({ enum: UxSignalScanStatus, default: UxSignalScanStatus.RUNNING })
  status!: UxSignalScanStatus;

  /** The telemetry window the detectors read, inclusive. */
  @Column({ name: 'window_from', type: 'date' })
  windowFrom!: string;

  @Column({ name: 'window_to', type: 'date' })
  windowTo!: string;

  /** Signals that crossed a detector threshold, before triage clustered them. */
  @Column({ name: 'signals_detected', type: 'int', default: 0 })
  signalsDetected!: number;

  @Column({ name: 'findings_created', type: 'int', default: 0 })
  findingsCreated!: number;

  @Column({ name: 'suggestions_created', type: 'int', default: 0 })
  suggestionsCreated!: number;

  /**
   * Items triage produced that were already open as a finding or pending as a
   * suggestion. A healthy steady state, not an error — see the class docblock.
   */
  @Column({ name: 'skipped_duplicates', type: 'int', default: 0 })
  skippedDuplicates!: number;

  /** Set with status FAILED. Kept as text: this is read by a human, not parsed. */
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /**
   * Per-detector counts and any detector that failed, for diagnosing a scan that
   * found nothing. Shaped like the suggestions payload's `sections.failed`: a
   * detector whose query errored is reported by name, never silently dropped.
   */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  metadata!: Record<string, unknown>;

  /**
   * The admin who pressed "Scan now", or NULL for a scheduled run. Integer
   * users.id with no foreign key, per ally-be convention.
   */
  @Column({ name: 'started_by', type: 'int', nullable: true })
  startedBy?: number | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}
