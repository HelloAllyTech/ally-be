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

  async getPermissionByName(name: string): Promise<Permission | null> {
    return this.permissionRepository.findOne({ where: { name } });
  }

  async createPermission(name: string): Promise<Permission> {
    const permission = this.permissionRepository.create({ name });
    return this.permissionRepository.save(permission);
  }

  async deletePermissionById(permissionId: number) {
    return this.permissionRepository.delete(permissionId);
  }
}
