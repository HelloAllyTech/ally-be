import { DataSource } from 'typeorm';
import { Tenant, TenantStatus } from '../../../tenant/entity/tenant.entity';
import { getRepo, log, upsert } from '../helpers';
import { tenants } from '../fixtures';

export async function seedTenants(ds: DataSource): Promise<Tenant[]> {
  const repo = getRepo(ds, Tenant);
  const saved: Tenant[] = [];

  for (const fixture of tenants) {
    const tenant = await upsert(
      repo,
      { code: fixture.code },
      {
        name: fixture.name,
        description: fixture.description,
        status: fixture.status ?? TenantStatus.ACTIVE,
        isTestOrganization: fixture.isTestOrganization ?? false,
      },
    );
    saved.push(tenant);
    log(`tenant ${tenant.code} → ${tenant.id}`);
  }

  return saved;
}
