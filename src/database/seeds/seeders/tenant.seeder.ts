import { DataSource } from 'typeorm';
import { Tenant, TenantStatus } from '../../../tenant/entity/tenant.entity';
import { getRepo, log, upsert } from '../helpers';
import { tenant } from '../fixtures';

export async function seedTenant(ds: DataSource): Promise<Tenant> {
  const repo = getRepo(ds, Tenant);
  const saved = await upsert(
    repo,
    { code: tenant.code },
    {
      name: tenant.name,
      description: tenant.description,
      status: TenantStatus.ACTIVE,
    },
  );
  log(`tenant ${tenant.code} → ${saved.id}`);
  return saved;
}
