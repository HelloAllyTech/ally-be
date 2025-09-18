import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './service/permissions.service';
import { GroupService } from './service/group.service';
import { Group } from '../common/entities/group.entity';
import { UserGroup } from '../common/entities/user-group.entity';
import { GroupRepository } from './repository/group.repository';
import { UserGroupRepository } from './repository/user-group.repository';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Group, UserGroup]), RedisModule],
  providers: [
    PermissionsService,
    GroupService,
    GroupRepository,
    UserGroupRepository,
  ],
  exports: [PermissionsService, GroupService],
})
export class AuthorizationModule {}
