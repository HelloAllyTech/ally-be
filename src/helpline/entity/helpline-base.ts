import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Columns every helpline table carries (contract §4). Not a `*.entity.ts`
 * file on purpose: the data-source glob loads only `entity/*.entity.js`, and
 * this abstract class is not a table.
 *
 * `tenant_id` holds the tenant **uuid** (`tenants.id`), normalised by
 * `HelplineTenantService` — never the code a JWT may carry instead.
 */
export abstract class HelplineTenantScopedEntity {
  @Column({ type: 'varchar', name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
