import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/**
 * Who is asking, and what slice of the character library are they allowed to
 * see. Two scopes only:
 *
 * - **platform** (holds SYSTEM_ACCESS): every row — the Ally-owned global
 *   characters plus every tenant's. This is the same discriminator
 *   OwnTenantScopeGuard and SettingsService use, so a tenant-scoped caller is
 *   pinned to their JWT tenant everywhere in the codebase, not just here.
 * - **tenant**: only rows stamped with their own tenant. Never the global ones
 *   and never another org's.
 */
export interface CharacterLibraryScope {
  /** True when the caller sees (and may edit) the whole library. */
  isPlatform: boolean;
  /**
   * The tenant a non-platform caller is pinned to. Null for a platform caller,
   * meaning "do not filter" on read and "create as Ally-owned" on write.
   */
  tenantId: string | null;
  /**
   * Set only for a platform caller restricted to an organization allowlist:
   * the organizations whose characters they see beside the global (Ally-owned)
   * ones. Every other org's private characters are hidden from them. They edit
   * those orgs' characters, and a global one only if they created it — the
   * rule roleplays and courses follow. Null for everyone else.
   */
  restrictedToTenantIds: string[] | null;
}

@Injectable()
export class CharacterLibraryAccessService {
  constructor(
    private readonly permissionValidator: PermissionValidator,
    private readonly tenantScopeService: TenantScopeService,
  ) {}

  async resolveScope(): Promise<CharacterLibraryScope> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    const isPlatform = await this.permissionValidator.validatePermissions(
      Number(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    if (isPlatform) {
      const scope = await this.tenantScopeService.resolveScope(Number(userId));
      return {
        isPlatform: true,
        tenantId: null,
        restrictedToTenantIds: scope.restricted
          ? (scope.tenantIds ?? [])
          : null,
      };
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      // A non-platform caller with no tenant on their JWT has no slice to be
      // scoped to. Fail closed rather than falling through to the global pool.
      throw new UnauthorizedException('Tenant context is required');
    }
    return { isPlatform: false, tenantId, restrictedToTenantIds: null };
  }
}
