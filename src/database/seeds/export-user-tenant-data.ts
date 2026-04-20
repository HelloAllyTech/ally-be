import { config } from 'dotenv';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { logStep } from './seed-utils';
import { UserTenantSeedData } from './user-tenant.seed-data';

const allyBeEnv = resolve(__dirname, '../../../.env');
if (existsSync(allyBeEnv)) {
  config({ path: allyBeEnv });
} else {
  config();
}

const OUTPUT_FILE = resolve(__dirname, './data/user-tenant.json');

async function exportUserTenantData(): Promise<void> {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    logStep('[user-tenant-export] Database connection established');

    const tenantsResult = await client.query<{
      code: string;
      name: string;
      description: string | null;
      logoUrl: string | null;
      metadata: Record<string, any> | null;
      settings: Record<string, any> | null;
    }>(`
      select
        code,
        name,
        description,
        "logoUrl",
        metadata,
        settings
      from tenants
      where "deletedAt" is null
      order by code asc
    `);

    const usersResult = await client.query<{
      email: string;
      name: string;
      username: string | null;
      phone: string | null;
      externalId: string | null;
      tenantCode: string | null;
      status: string;
      roles: string[] | null;
      adminTenantCodes: string[] | null;
    }>(`
      with user_roles as (
        select
          ug."userId",
          array_agg(distinct g.name order by g.name) as roles
        from user_groups ug
        inner join groups g on g.id = ug."groupId"
        group by ug."userId"
      ),
      admin_tenant_codes as (
        select
          at."userId",
          array_agg(distinct t.code order by t.code) as "adminTenantCodes"
        from admin_tenants at
        inner join tenants t on t.id = at."tenantId"
        where at."deletedAt" is null
          and t."deletedAt" is null
        group by at."userId"
      )
      select
        u.email,
        u.name,
        u.username,
        u.phone,
        u."externalId",
        coalesce(tenant_by_id.code, tenant_by_code.code) as "tenantCode",
        u.status,
        coalesce(ur.roles, '{}'::varchar[]) as roles,
        coalesce(atc."adminTenantCodes", '{}'::varchar[]) as "adminTenantCodes"
      from users u
      left join user_roles ur on ur."userId" = u.id
      left join admin_tenant_codes atc on atc."userId" = u.id
      left join tenants tenant_by_id
        on tenant_by_id.id::text = u.tenant_id
       and tenant_by_id."deletedAt" is null
      left join tenants tenant_by_code
        on tenant_by_code.code = u.tenant_id
       and tenant_by_code."deletedAt" is null
      where not ('SUPER_ADMIN' = any(coalesce(ur.roles, '{}'::varchar[])))
      order by coalesce(tenant_by_id.code, tenant_by_code.code) asc, u.email asc
    `);

    const skippedUsers = usersResult.rows.filter((user) => !user.tenantCode);
    if (skippedUsers.length > 0) {
      logStep(
        `[user-tenant-export] Skipping ${skippedUsers.length} users without a matching tenant`,
      );
    }

    const data: UserTenantSeedData = {
      source: {
        generatedAt: new Date().toISOString(),
        database: process.env.DB_DATABASE || 'unknown',
        tenantCount: tenantsResult.rows.length,
        userCount: usersResult.rows.filter((user) => user.tenantCode).length,
      },
      tenants: tenantsResult.rows,
      users: usersResult.rows
        .filter((user) => user.tenantCode)
        .map((user) => ({
          email: user.email,
          name: user.name,
          username: user.username,
          phone: user.phone,
          externalId: user.externalId,
          tenantCode: user.tenantCode!,
          roles: user.roles ?? [],
          status: user.status as any,
          adminTenantCodes: user.adminTenantCodes ?? [],
        })),
    };

    writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
    logStep(
      `[user-tenant-export] Wrote ${data.users.length} users across ${data.tenants.length} tenants to ${OUTPUT_FILE}`,
    );
  } catch (error: any) {
    console.error(
      '[user-tenant-export] Failed to export user seed data:',
      error.message,
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

exportUserTenantData();
