import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HELPLINE_TIMINGS } from '../constants/helpline.constants';
import { HelplineTenant } from '../type/helpline.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unknown identifiers are remembered briefly, so probing public codes costs no DB reads. */
const NEGATIVE_CACHE_MS = 30_000;

/**
 * Normalises a tenant identifier — a JWT carries either the uuid or the code —
 * to `{ id, code, name, logoUrl }`. Helpline rows store `id`; preferences key
 * on `code` (contract §3). Memoised in process for 5 minutes: tenants are
 * effectively immutable, and this runs on every public status read.
 */
@Injectable()
export class HelplineTenantService {
  private readonly cache = new Map<
    string,
    { value: HelplineTenant | null; expires: number }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async resolve(identifier?: string | null): Promise<HelplineTenant | null> {
    const key = identifier?.trim();
    if (!key) return null;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const rows: {
      id: string;
      code: string;
      name: string;
      logoUrl: string | null;
    }[] = UUID.test(key)
      ? await this.dataSource.query(
          `SELECT id, code, name, "logoUrl" FROM tenants WHERE id = $1::uuid AND "deletedAt" IS NULL LIMIT 1`,
          [key],
        )
      : await this.dataSource.query(
          `SELECT id, code, name, "logoUrl" FROM tenants WHERE code = $1 AND "deletedAt" IS NULL LIMIT 1`,
          [key],
        );
    const row = rows?.[0];
    const value: HelplineTenant | null = row
      ? {
          id: String(row.id),
          code: row.code,
          name: row.name,
          logoUrl: row.logoUrl ?? null,
        }
      : null;
    this.cache.set(key, {
      value,
      expires:
        Date.now() +
        (value ? HELPLINE_TIMINGS.TENANT_CACHE_MS : NEGATIVE_CACHE_MS),
    });
    return value;
  }
}
