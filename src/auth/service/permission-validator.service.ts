import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../../authorization/service/permissions.service';

@Injectable()
export class PermissionValidator {
  constructor(private readonly permissionsService: PermissionsService) {}

  async validatePermissions(
    userId: number,
    permissions: string[],
    operation?: 'AND' | 'OR',
  ): Promise<boolean> {
    if (!permissions?.length || !userId) return true;

    const userPermissions =
      await this.permissionsService.getUserPermissions(userId);
    return !operation || operation === 'AND'
      ? permissions.every((permission) => userPermissions.includes(permission))
      : permissions.some((permission) => userPermissions.includes(permission));
  }
}
