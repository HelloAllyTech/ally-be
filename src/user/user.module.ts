import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../common/entities/user.entity';
import { UserService } from './user.service';
import { QueueModule } from '../queue/queue.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), QueueModule],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
