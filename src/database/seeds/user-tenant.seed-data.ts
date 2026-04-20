import { UserStatus } from '../../user/constants/user-status.constants';

export interface SeedTenantRecord {
  code: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  metadata?: Record<string, any> | null;
  settings?: Record<string, any> | null;
}

export interface SeedUserRecord {
  email: string;
  name: string;
  username?: string | null;
  phone?: string | null;
  externalId?: string | null;
  tenantCode: string;
  roles: string[];
  status?: UserStatus;
  adminTenantCodes?: string[];
}

export interface UserTenantSeedData {
  source: {
    generatedAt: string;
    database: string;
    tenantCount: number;
    userCount: number;
  };
  tenants: SeedTenantRecord[];
  users: SeedUserRecord[];
}
