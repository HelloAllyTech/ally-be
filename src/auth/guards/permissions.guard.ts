import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
    private userService: UserService,
    private config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<{
      permissions: string[];
      operator: 'AND' | 'OR';
    }>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.permissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    const userPermissions = await this.permissionsService.getUserPermissions(
      user.id,
    );

    const requiresTermsAndAgreementApproval = userPermissions.includes(
      PERMISSIONS.REQUIRE_TERMS_AND_AGREEMENT_APPROVAL,
    );

    if (
      this.config.featureFlag.termsAndAgreement &&
      requiresTermsAndAgreementApproval
    ) {
      const termsAndAgreementApproval =
        await this.userService.getTermsAndAgreementApproval(user.id);
      if (!termsAndAgreementApproval) {
        throw new ForbiddenException('Terms and conditions must be accepted');
      }
    }

    // Check if user has all required permissions
    if (requiredPermissions.operator === 'AND') {
      return requiredPermissions.permissions.every((permission) =>
        userPermissions.includes(permission),
      );
    } else {
      return requiredPermissions.permissions.some((permission) =>
        userPermissions.includes(permission),
      );
    }
  }
}
