import { Module, forwardRef } from '@nestjs/common';
import { RedisBrokerService } from './service/redis-broker.service';
import { MessageBrokerService } from './service/message-broker.service';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [forwardRef(() => ChatModule)],
  providers: [
    { provide: 'MessageBroker', useClass: RedisBrokerService },
    MessageBrokerService,
  ],
  exports: [MessageBrokerService],
})
export class BrokerModule {}
