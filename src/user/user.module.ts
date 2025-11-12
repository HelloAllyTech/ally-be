import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './controller/user.controller';
import { UserService } from './service/user.service';
import { QueueModule } from '../queue/queue.module';
import { UserRepository } from './repository/user.repository';
import { TenantModule } from 'src/tenant/tenant.module';
import { LearnModule } from 'src/learn/learn.module';
import { AuthorizationModule } from 'src/authorization/authorization.module';

@Module({
  imports: [
    QueueModule,
    forwardRef(() => LearnModule),
    forwardRef(() => TenantModule),
    AuthorizationModule,
  ],
  providers: [UserService, UserRepository],
  controllers: [UserController],
  exports: [UserService, UserRepository],
})
export class UserModule {}
