import { EntityManager } from 'typeorm';

// Arbitrary but fixed namespace, distinct from the scheduler's (4919) and the
// UX-signal writer's (4920), so these locks can never collide with theirs.
const GLOBAL_SCENARIO_TENANT_LOCK_NAMESPACE = 4921;
const GLOBAL_SCENARIO_TENANT_LOCK_KEY = 1;

/**
 * Serialises the two halves of the global-scenario fan-out: creating a global
 * scenario (which reads every tenant and writes a `scenario_tenants` row for
 * each) and creating a tenant (which reads every global scenario and does the
 * same).
 *
 * On their own both are a read followed by a write, and the two can interleave
 * so that *neither* sees the other: the scenario transaction reads the tenant
 * list before the new tenant commits, the tenant transaction reads the global
 * scenario list before the new scenario commits, and the pair ends up with no
 * mapping row from either side. The scenario is then silently missing for that
 * tenant, with nothing to repair it short of a manual backfill.
 *
 * A transaction-level lock held across the read fixes the ordering: whichever
 * transaction commits second necessarily takes the lock after the first one
 * released it at commit, so its read — a fresh statement snapshot under READ
 * COMMITTED — sees the row the first one wrote. It is released when the
 * transaction ends, including on rollback, so a failed create cannot wedge the
 * next one.
 *
 * Must be called on the transaction's own `EntityManager`; a lock taken on a
 * different connection is not held for the duration of the transaction.
 */
export async function acquireGlobalScenarioTenantLock(
  entityManager: EntityManager,
): Promise<void> {
  await entityManager.query('SELECT pg_advisory_xact_lock($1, $2)', [
    GLOBAL_SCENARIO_TENANT_LOCK_NAMESPACE,
    GLOBAL_SCENARIO_TENANT_LOCK_KEY,
  ]);
}
