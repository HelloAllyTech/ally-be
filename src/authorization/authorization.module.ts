import { forwardRef, Global, Module } from '@nestjs/common';
import { PermissionsService } from './service/permissions.service';
import { GroupService } from './service/group.service';
import { GroupRepository } from './repository/group.repository';
import { UserGroupRepository } from './repository/user-group.repository';
import { GroupPermissionsService } from './service/group-permissions.service';
import { UserGroupService } from './service/user-group.service';
import { AuthorizationController } from './controller/authorization.controller';
import { GroupPermissionsRepository } from './repository/group-permissions.repository';
import { RedisModule } from '../redis/redis.module';
import { PermissionValidator } from './service/permission-validator.service';
import { UserModule } from '../user/user.module';

@Global()
@Module({
  imports: [RedisModule, forwardRef(() => UserModule)],
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
    UserGroupRepository,
    GroupRepository,
  ],
})
export class AuthorizationModule {}
