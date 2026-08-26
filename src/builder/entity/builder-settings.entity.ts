import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Singleton row of platform-level Builder controls (the bug_hunter_settings
 * pattern).
 *
 * `enabled` defaults to **false**. An agent that writes code and opens pull
 * requests should not become reachable merely because a migration ran — the
 * feature toggle governs who can see the tab, and this governs whether the
 * thing behind it will actually dispatch.
 */
@Entity('builder_settings')
export class BuilderSettings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /**
   * Ceiling on concurrent BUILDING sessions. Each one holds a GitHub runner
   * for up to two hours, so this is a spend and capacity control, not a
   * correctness one.
   */
  @Column({ type: 'int', default: 3 })
  maxConcurrentBuilds!: number;

  /** Applied to a new session's budgetUsd. Null disables the cap. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  defaultBudgetUsd?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  defaultEngine?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  defaultModel?: string | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
