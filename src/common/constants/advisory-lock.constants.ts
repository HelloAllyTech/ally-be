/**
 * Postgres advisory-lock namespaces, kept in one place so two of them can never
 * collide by accident. 4919 belongs to the scheduler and 4920 to the ux-signal
 * writer; both hold their key privately because nothing outside those files
 * takes them.
 *
 * This one is shared on purpose: the two writers it serialises live in
 * different modules.
 */
export const SCENARIO_TENANT_LOCK_NAMESPACE = 4921;

/**
 * Guards the pairing between global simulations and tenants — the rule that
 * every tenant has a `scenario_tenants` row for every global simulation.
 *
 * Two transactions maintain it from opposite ends: creating a global
 * simulation (or duplicating one) fans it out to every tenant, and creating a
 * tenant fans every global simulation in to it. Under READ COMMITTED neither
 * sees the other's uncommitted row, so without a lock both can commit having
 * read a world in which the other did not exist, and the pair is simply never
 * written — a copy no tenant created in that window can ever reach, with
 * nothing to backfill it. Both ends must take this lock; one alone serialises
 * nothing.
 */
export const SCENARIO_TENANT_LOCK_KEY = 1;
