import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './controller/user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../common/entities/user.entity';
import { UserService } from './service/user.service';
import { QueueModule } from '../queue/queue.module';
import { UserRepository } from './repository/user.repository';
import { Group } from 'src/common/entities/group.entity';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { TenantModule } from 'src/tenant/tenant.module';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Group, UserGroup]),
    QueueModule,
    TenantModule,
    forwardRef(() => LearnModule),
  ],
  providers: [UserService, UserRepository],
  controllers: [UserController],
  exports: [UserService, UserRepository],
})
export class UserModule {}
