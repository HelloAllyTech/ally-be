import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PLATFORM_WIDE_ONLY_MESSAGE,
  TenantScopeService,
} from 'src/authorization/service/tenant-scope.service';

/**
 * Refuses a platform admin restricted to an organization allowlist on a
 * route whose data or effect spans every organization — one that cannot be
 * narrowed to a set of orgs, so the only safe answer is no.
 *
 * Applied through @PlatformWidePermissions, which runs it after the JWT and
 * permission guards so `request.user` exists.
 */
@Injectable()
export class PlatformWideGuard implements CanActivate {
  constructor(private readonly tenantScopeService: TenantScopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (!user) {
      throw new UnauthorizedException();
    }
    if (await this.tenantScopeService.isRestricted(Number(user.id))) {
      throw new ForbiddenException(PLATFORM_WIDE_ONLY_MESSAGE);
    }
    return true;
  }
}
