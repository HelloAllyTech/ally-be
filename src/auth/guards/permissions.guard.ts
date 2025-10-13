import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsService } from 'src/authorization/service/permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<{
      permissions: string[];
      operator: 'AND' | 'OR';
    }>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    console.log('requiredPermissions', requiredPermissions);
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
