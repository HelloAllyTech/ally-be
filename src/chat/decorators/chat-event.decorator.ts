import { SubscribeMessage } from '@nestjs/websockets';

import { ChatEvents } from '../constants/chat.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';

export function SubscribeAndRunWithContext(
  event: ChatEvents,
  propagation: ExecutionContextPropagation = ExecutionContextPropagation.SUPPORTS,
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    // Apply the SubscribeMessage decorator
    SubscribeMessage(event)(target, propertyKey, descriptor);

    // Apply the WithExecutionContext decorator
    return WithExecutionContext(propagation)(target, propertyKey, descriptor);
  };
}
