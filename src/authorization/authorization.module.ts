import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './service/permissions.service';
import { GroupService } from './service/group.service';
import { Group } from './entity/group.entity';
import { UserGroup } from './entity/user-group.entity';
import { GroupRepository } from './repository/group.repository';
import { UserGroupRepository } from './repository/user-group.repository';
import { GroupPermissionsService } from './service/group-permissions.service';
import { UserGroupService } from './service/user-group.service';
import { AuthorizationController } from './controller/authorization.controller';
import { GroupPermission } from './entity/group-permission.entity';
import { Permission } from './entity/permission.entity';
import { GroupPermissionsRepository } from './repository/group-permissions.repository';
import { RedisModule } from '../redis/redis.module';
import { User } from 'src/user/entity/user.entity';
import { PermissionValidator } from './service/permission-validator.service';
import { UserModule } from '../user/user.module';
import { AdminFeatureToggle } from './entity/admin-feature-toggle.entity';
import { AdminFeatureToggleRepository } from './repository/admin-feature-toggle.repository';
import { FeatureToggleService } from './service/feature-toggle.service';
import { TenantFeatureService } from './service/tenant-feature.service';
import { AdminTenant } from 'src/user/entity/admin-tenant.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Group,
      UserGroup,
      GroupPermission,
      Permission,
      AdminFeatureToggle,
      // Plain entity, registered here (not just in UserModule) so
      // PermissionsService.isMultiTenantAdmin can query admin_tenants
      // directly via a Repository — importing AdminTenantService itself
      // would pull in a circular require chain with UserModule and break
      // Nest's decorator metadata resolution at boot.
      AdminTenant,
    ]),
    RedisModule,
    forwardRef(() => UserModule),
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
    AdminFeatureToggleRepository,
    FeatureToggleService,
    TenantFeatureService,
  ],
  exports: [
    PermissionsService,
    GroupService,
    GroupPermissionsService,
    UserGroupService,
    PermissionValidator,
    UserGroupRepository,
    GroupRepository,
    FeatureToggleService,
    AdminFeatureToggleRepository,
    TenantFeatureService,
  ],
})
export class AuthorizationModule {}
