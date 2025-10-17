import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './service/permissions.service';
import { GroupService } from './service/group.service';
import { Group } from '../common/entities/group.entity';
import { UserGroup } from '../common/entities/user-group.entity';
import { GroupRepository } from './repository/group.repository';
import { UserGroupRepository } from './repository/user-group.repository';
import { GroupPermissionsService } from './service/group-permissions.service';
import { UserGroupService } from './service/user-group.service';
import { AuthorizationController } from './controller/authorization.controller';
import { GroupPermission } from '../common/entities/group-permission.entity';
import { Permission } from '../common/entities/permission.entity';
import { GroupPermissionsRepository } from './repository/group-permissions.repository';
import { RedisModule } from '../redis/redis.module';
import { PermissionValidator } from './service/permission-validator.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Group, UserGroup, GroupPermission, Permission]),
    RedisModule,
  ],
  controllers: [AuthorizationController],
  providers: [
    PermissionsService,
    GroupService,
    GroupPermissionsService,
    UserGroupService,
    GroupRepository,
    UserGroupRepository,
    GroupPermissionsRepository,
    PermissionValidator,
  ],
  exports: [
    PermissionsService,
    GroupService,
    GroupPermissionsService,
    UserGroupService,
    PermissionValidator,
  ],
})
export class AuthorizationModule {}
