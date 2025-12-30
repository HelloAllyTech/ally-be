import { Message } from '@aws-sdk/client-sqs';

export interface SqsHandler {
  queueUrl: string;
  handler: (message: Message) => Promise<void>;
  isDlq: boolean;
  target: any;
  methodName: string;
  targetConstructor: any;
}

class SqsHandlerRegistry {
  private handlers: SqsHandler[] = [];

  registerHandler(
    queueUrl: string,
    target: any,
    methodName: string,
    isDlq: boolean = false,
  ): void {
    const handler = async (message: Message) => {
      await target[methodName](message);
    };

    this.handlers.push({
      queueUrl,
      handler,
      isDlq,
      target,
      methodName,
      targetConstructor: target.constructor,
    });
  }

  getHandlers(): SqsHandler[] {
    return this.handlers;
  }

  getHandlersByQueue(queueUrl: string): SqsHandler[] {
    return this.handlers.filter((h) => h.queueUrl === queueUrl);
  }
}

export const sqsHandlerRegistry = new SqsHandlerRegistry();
