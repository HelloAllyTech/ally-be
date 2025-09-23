import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './service/permissions.service';
import { GroupService } from './service/group.service';
import { GroupPermissionsService } from './service/group-permissions.service';
import { UserGroupService } from './service/user-group.service';
import { Group } from '../common/entities/group.entity';
import { UserGroup } from '../common/entities/user-group.entity';
import { GroupPermission } from '../common/entities/group-permission.entity';
import { Permission } from '../common/entities/permission.entity';
import { GroupRepository } from './repository/group.repository';
import { UserGroupRepository } from './repository/user-group.repository';
import { GroupPermissionsRepository } from './repository/group-permissions.repository';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Group, UserGroup, GroupPermission, Permission]),
    RedisModule,
  ],
  providers: [
    PermissionsService,
    GroupService,
    GroupPermissionsService,
    UserGroupService,
    GroupRepository,
    UserGroupRepository,
    GroupPermissionsRepository,
  ],
  exports: [
    PermissionsService,
    GroupService,
    GroupPermissionsService,
    UserGroupService,
  ],
})
export class AuthorizationModule {}
