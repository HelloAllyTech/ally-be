import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../common/entities/user.entity';
import { UserService } from './user.service';
import { QueueModule } from '../queue/queue.module';
import { GroupService } from './group.service';
import { Group } from '../common/entities/group.entity';
@Module({
  imports: [TypeOrmModule.forFeature([User, Group]), QueueModule],
  providers: [UserService, GroupService],
  controllers: [UserController],
  exports: [UserService, GroupService],
})
export class UserModule {}
