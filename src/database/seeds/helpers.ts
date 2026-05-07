import {
  DataSource,
  DataSourceOptions,
  EntityTarget,
  Repository,
} from 'typeorm';
import * as bcrypt from 'bcrypt';
import { DB } from './config';

import { Tenant } from '../../tenant/entity/tenant.entity';
import { User } from '../../user/entity/user.entity';
import { AdminTenant } from '../../user/entity/admin-tenant.entity';
import { Group } from '../../authorization/entity/group.entity';
import { UserGroup } from '../../authorization/entity/user-group.entity';
import { Scenarios } from '../../learn/entity/scenarios.entity';
import { ScenarioTenants } from '../../learn/entity/scenario-tenants.entity';
import { ScenarioVoices } from '../../learn/entity/scenario-voices.entity';
import { ScenarioSessions } from '../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../learn/entity/scenario-session-messages.entity';
import { Languages } from '../../language/entity/languages.entity';
import { SessionEvents } from '../../session-event/entity/session-events.entity';
import { ScenarioPath } from '../../scenario-path/entity/scenario-path.entity';
import { ScenarioPathItem } from '../../scenario-path/entity/scenario-path-item.entity';
import { ScenarioPathTenant } from '../../scenario-path/entity/scenario-path-tenant.entity';
import { Badge } from '../../badge/entity/badge.entity';
import { BadgeGroup } from '../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../badge/entity/badge-tenant.entity';
import { Case } from '../../case/entity/case.entity';
import { CaseItem } from '../../case/entity/case-item.entity';
import { CaseTenant } from '../../case/entity/case-tenant.entity';
import { ScenarioCoverImageLibrary } from '../../scenario-cover-image-library/entity/scenario-cover-image-library.entity';
import { Competency } from '../../learn/entity/competency.entity';
import { Behavior } from '../../learn/entity/behavior.entity';
import { ScenarioBehaviorInstruction } from '../../learn/entity/scenario-behavior-instruction.entity';

export const SEED_ENTITIES = [
  Tenant,
  User,
  AdminTenant,
  Group,
  UserGroup,
  Scenarios,
  ScenarioTenants,
  ScenarioVoices,
  ScenarioSessions,
  ScenarioSessionMessages,
  Languages,
  SessionEvents,
  ScenarioPath,
  ScenarioPathItem,
  ScenarioPathTenant,
  Badge,
  BadgeGroup,
  BadgeTenant,
  Case,
  CaseItem,
  CaseTenant,
  ScenarioCoverImageLibrary,
  Competency,
  Behavior,
  ScenarioBehaviorInstruction,
];

export function createSeedDataSource(): DataSource {
  const options: DataSourceOptions = {
    type: 'postgres',
    host: DB.host,
    port: DB.port,
    username: DB.username,
    password: DB.password,
    database: DB.database,
    entities: SEED_ENTITIES,
    synchronize: false,
    ssl: DB.ssl ? { rejectUnauthorized: false } : false,
    logging: false,
  };
  return new DataSource(options);
}

export function log(message: string): void {
  console.log(`[seed] ${message}`);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Idempotent insert: find by `matchOn`, insert if missing, return the row.
 * Does not update existing rows — seeds should be safe to re-run without
 * clobbering manually-edited dev data.
 */
export async function upsert<T extends object>(
  repo: Repository<T>,
  matchOn: Partial<T>,
  defaults: Partial<T>,
): Promise<T> {
  const existing = await repo.findOne({ where: matchOn as any });
  if (existing) return existing;
  const created = repo.create({ ...matchOn, ...defaults } as any);
  return repo.save(created as any);
}

export async function withDataSource<T>(
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  const ds = createSeedDataSource();
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

export function getRepo<T extends object>(
  ds: DataSource,
  entity: EntityTarget<T>,
): Repository<T> {
  return ds.getRepository(entity);
}
