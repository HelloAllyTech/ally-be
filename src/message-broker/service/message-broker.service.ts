import { Inject, Injectable } from '@nestjs/common';
import { MessageBroker } from '../interface/message-broker.interface';

@Injectable()
export class MessageBrokerService {
  constructor(
    @Inject('MessageBroker') private readonly broker: MessageBroker,
  ) {}

  async publish(channel: string, message: any) {
    await this.broker.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: any) => void) {
    await this.broker.subscribe(channel, callback);
  }
}
