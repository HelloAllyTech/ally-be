import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../../authorization/service/permissions.service';

@Injectable()
export class PermissionValidator {
  constructor(private readonly permissionsService: PermissionsService) {}

  async validatePermissions(
    userId: number,
    permissions: string[],
  ): Promise<boolean> {
    if (!permissions?.length || !userId) return true;

    const userPermissions =
      await this.permissionsService.getUserPermissions(userId);
    return permissions.every((permission) =>
      userPermissions.includes(permission),
    );
  }
}
