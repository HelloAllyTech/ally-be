import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * A human evaluator: a lightweight, standalone account (NOT a platform user —
 * no roles/groups/tenant) created by a super-duper-admin in the AI Lab.
 * Evaluators sign in to the /evaluate micro-app with email + an
 * admin-generated password (stored only as a hash; the plaintext is shown to
 * the admin once at create/regenerate time for offline sharing).
 */
@Entity('lab_evaluators')
export class LabEvaluator extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stored lowercase; uniqueness is on the normalized value. */
  @Index('idx_lab_evaluators_email', { unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  /**
   * Bumped on every password regeneration; embedded in issued JWTs so a
   * regenerate immediately invalidates any tokens minted with the old
   * password.
   */
  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion!: number;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
