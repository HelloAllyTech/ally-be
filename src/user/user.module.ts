import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './controller/user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './service/user.service';
import { QueueModule } from '../queue/queue.module';
import { UserRepository } from './repository/user.repository';
import { TenantModule } from 'src/tenant/tenant.module';
import { LearnModule } from 'src/learn/learn.module';
import { AuthorizationModule } from 'src/authorization/authorization.module';
import { User } from './entity/user.entity';
import { AdminTenant } from './entity/admin-tenant.entity';
import { AdminTenantRepository } from './repository/admin-tenant.repository';
import { AdminTenantService } from './service/admin-tenant.service';
import { UserPreferencesRepository } from './repository/user-prefernces.repository';
import { AwsModule } from 'src/aws/aws.module';
import { SettingsModule } from 'src/settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AdminTenant]),
    QueueModule,
    forwardRef(() => LearnModule),
    forwardRef(() => TenantModule),
    AuthorizationModule,
    AwsModule,
    forwardRef(() => SettingsModule),
  ],
  providers: [
    UserService,
    UserRepository,
    UserPreferencesRepository,
    AdminTenantRepository,
    AdminTenantService,
  ],
  controllers: [UserController],
  exports: [
    UserService,
    UserRepository,
    AdminTenantRepository,
    AdminTenantService,
  ],
})
export class UserModule {}
