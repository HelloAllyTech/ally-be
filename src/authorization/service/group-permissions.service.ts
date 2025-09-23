import { Injectable } from '@nestjs/common';
import { GroupPermissionsRepository } from '../repository/group-permissions.repository';

@Injectable()
export class GroupPermissionsService {
  constructor(
    private readonly groupPermissionsRepository: GroupPermissionsRepository,
  ) {}

  async getGroupPermissions(groupIds: number[]): Promise<string[]> {
    return this.groupPermissionsRepository.findPermissionsByGroupId(groupIds);
  }
}
