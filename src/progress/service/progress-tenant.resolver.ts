import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collapses the two forms a tenant identifier arrives in down to the tenant's uuid.
 *
 * `tenant_id` is a varchar across most of the schema and in practice holds a mix: some
 * rows carry the tenant's uuid, others its short code. On the local dataset a single
 * tenant appears both ways in `scenario_sessions`. Left alone, that splits one learner
 * into two `user_progress` rows — one per spelling of their tenant — and the dashboard
 * shows whichever half the reader happened to key on.
 *
 * Everything the progress module writes or reads goes through here first, so a learner
 * has exactly one row no matter which spelling reached it.
 */
@Injectable()
export class ProgressTenantResolver {
  private readonly logger = new Logger(ProgressTenantResolver.name);

  /** Tenants are few and effectively immutable, so a process-lifetime cache is enough. */
  private readonly cache = new Map<string, string>();

  constructor(private readonly dataSource: DataSource) {}

  async toCanonicalId(tenantIdentifier: string): Promise<string> {
    if (!tenantIdentifier) return tenantIdentifier;

    const cached = this.cache.get(tenantIdentifier);
    if (cached) return cached;

    // A uuid is already canonical; verifying it exists would cost a query per request
    // for no benefit, since a bogus uuid simply matches no rows downstream.
    if (UUID_PATTERN.test(tenantIdentifier)) {
      this.cache.set(tenantIdentifier, tenantIdentifier);
      return tenantIdentifier;
    }

    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT "id" FROM "tenants" WHERE "code" = $1 LIMIT 1`,
      [tenantIdentifier],
    );

    const resolved = rows[0]?.id;
    if (!resolved) {
      // Fall back to the identifier as given rather than throwing: failing to award XP
      // is better than breaking the flow that triggered it, and the row stays findable.
      this.logger.warn(
        `No tenant matched code "${tenantIdentifier}"; using it as-is`,
      );
      return tenantIdentifier;
    }

    this.cache.set(tenantIdentifier, resolved);
    return resolved;
  }
}
