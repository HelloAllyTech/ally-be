import { Injectable } from '@nestjs/common';
import { GroupPermissionsRepository } from '../repository/group-permissions.repository';

@Injectable()
export class GroupPermissionsService {
  constructor(
    private readonly groupPermissionsRepository: GroupPermissionsRepository,
  ) {}

  async getGroupPermissions(
    groupIds: number[],
  ): Promise<{ groupId: number; permission: string }[]> {
    const permissions =
      await this.groupPermissionsRepository.findPermissionsByGroupId(groupIds);

    return permissions;
  }

  async findByPermissionId(permissionId: number) {
    return this.groupPermissionsRepository.findByPermissionId(permissionId);
  }

  async createGroupPermission(groupIds: number[], permissionId: number) {
    return this.groupPermissionsRepository.createGroupPermission(
      groupIds,
      permissionId,
    );
  }

  async deleteGroupsPermission(permissionId: number, groupIds?: number[]) {
    return this.groupPermissionsRepository.deleteGroupsPermission(
      permissionId,
      groupIds,
    );
  }
}
