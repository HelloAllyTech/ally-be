import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from 'src/common/entities/permission.entity';

@Injectable()
export class PermissionRepository {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async getPermissionByName(
    permissionName: string,
  ): Promise<Permission | null> {
    return this.permissionRepository.findOne({
      where: { name: permissionName },
    });
  }

  async createPermission(permissionName: string): Promise<Permission> {
    const permission = this.permissionRepository.create({
      name: permissionName,
    });
    return this.permissionRepository.save(permission);
  }

  async deletePermissionById(permissionId: number) {
    return this.permissionRepository.delete(permissionId);
  }
}
