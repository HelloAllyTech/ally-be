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
import { UserPreferencesRepository } from './repository/user-prefernces.repository';
import { AwsModule } from 'src/aws/aws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AdminTenant]),
    QueueModule,
    forwardRef(() => LearnModule),
    forwardRef(() => TenantModule),
    AuthorizationModule,
    AwsModule,
  ],
  providers: [UserService, UserRepository, UserPreferencesRepository],
  controllers: [UserController],
  exports: [UserService, UserRepository],
})
export class UserModule {}
