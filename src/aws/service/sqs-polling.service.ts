import { Message } from '@aws-sdk/client-sqs';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LoggerService } from '../../logger/logger.service';
import {
  SqsHandler,
  sqsHandlerRegistry,
} from '../registry/sqs-handler.registry';
import { SqsService } from './sqs.service';

interface QueuePoller {
  queueUrl: string;
  handlers: SqsHandler[];
  isPolling: boolean;
  pollInterval: number;
}

@Injectable()
export class SqsPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(SqsPollingService.name);
  private queuePollers: Map<string, QueuePoller> = new Map();
  private readonly defaultPollInterval = 5000; // 5 seconds between polling cycles

  constructor(
    private readonly sqsService: SqsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.initializePollers();
    await this.startAllPollers();
  }

  async onModuleDestroy() {
    await this.stopAllPollers();
  }

  private async initializePollers(): Promise<void> {
    const handlers = sqsHandlerRegistry.getHandlers();

    if (handlers.length === 0) {
      this.logger.warn('No SQS handlers registered');
      return;
    }

    // Group handlers by queue URL and resolve instances
    const handlersByQueue = new Map<string, SqsHandler[]>();

    for (const handler of handlers) {
      // Skip handlers whose queue URL isn't configured (e.g. a feature's queue
      // not yet provisioned in this environment) — otherwise we'd spin up a
      // poller against an undefined URL and error-loop every cycle.
      if (!handler.queueUrl) {
        this.logger.warn(
          `Skipping SQS handler ${handler.targetConstructor?.name}.${handler.methodName}: queue URL is not configured`,
        );
        continue;
      }

      try {
        // Get the actual instance from the NestJS container
        const instance = this.moduleRef.get(handler.targetConstructor, {
          strict: false,
        });

        // Create a properly bound handler
        const boundHandler: SqsHandler = {
          ...handler,
          handler: async (message: Message) => {
            await instance[handler.methodName](message);
          },
        };

        if (!handlersByQueue.has(handler.queueUrl)) {
          handlersByQueue.set(handler.queueUrl, []);
        }
        handlersByQueue.get(handler.queueUrl)!.push(boundHandler);
      } catch (error) {
        this.logger.error(
          `Failed to resolve handler instance for ${handler.targetConstructor?.name}.${handler.methodName} with error ${JSON.stringify(
            error,
          )}`,
        );
      }
    }

    // Create pollers for each unique queue
    for (const [queueUrl, queueHandlers] of handlersByQueue) {
      this.queuePollers.set(queueUrl, {
        queueUrl,
        handlers: queueHandlers,
        isPolling: false,
        pollInterval: this.defaultPollInterval,
      });

      this.logger.debug(
        `Initialized poller for queue: ${queueUrl} with ${queueHandlers.length} handler(s)`,
      );
    }
  }

  private async startAllPollers(): Promise<void> {
    const pollerPromises = Array.from(this.queuePollers.values()).map(
      (poller) => this.startPoller(poller),
    );

    await Promise.all(pollerPromises);
    this.logger.debug(`Started polling for ${this.queuePollers.size} queue(s)`);
  }

  private async stopAllPollers(): Promise<void> {
    for (const poller of this.queuePollers.values()) {
      poller.isPolling = false;
    }
    this.logger.debug('Stopped all queue pollers');
  }

  private async startPoller(poller: QueuePoller): Promise<void> {
    if (poller.isPolling) return;

    this.logger.debug(`Starting polling for queue: ${poller.queueUrl}`);
    poller.isPolling = true;

    // Run polling in background
    setImmediate(() => this.pollQueue(poller));
  }

  private async pollQueue(poller: QueuePoller): Promise<void> {
    while (poller.isPolling) {
      try {
        await this.pollMessages(poller);
      } catch (error) {
        this.logger.error(
          `Error during polling for queue ${poller.queueUrl} with error ${JSON.stringify(
            error,
          )}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poller.pollInterval));
    }
  }

  private async pollMessages(poller: QueuePoller): Promise<void> {
    try {
      const messages = await this.sqsService.receiveMessage(poller.queueUrl);

      if (messages.length > 0) {
        this.logger.debug(
          `Received ${messages.length} message(s) from queue: ${poller.queueUrl}`,
        );

        // Process messages concurrently
        await Promise.all(
          messages.map((message) => this.processMessage(poller, message)),
        );
      }
    } catch (error) {
      this.logger.error(
        `Error receiving messages from queue ${poller.queueUrl} with error ${JSON.stringify(
          error,
        )}`,
      );
    }
  }

  private async processMessage(
    poller: QueuePoller,
    message: Message,
  ): Promise<void> {
    if (!message.Body) {
      this.logger.warn('Received message without body', {
        messageId: message.MessageId,
      });
      return;
    }

    let messageProcessedSuccessfully = false;

    // Try each handler for this queue
    for (const handler of poller.handlers) {
      try {
        this.logger.debug(
          `Processing message ${message.MessageId} with handler ${handler.target.constructor.name}.${handler.methodName}`,
        );

        await handler.handler(message);
        messageProcessedSuccessfully = true;

        this.logger.debug(
          `Successfully processed message ${message.MessageId} with handler ${handler.target.constructor.name}.${handler.methodName}`,
        );

        // If one handler succeeds, break out of the loop
        break;
      } catch (error) {
        this.logger.error(
          `Handler ${handler.target.constructor.name}.${handler.methodName} failed to process message ${message.MessageId} with error ${JSON.stringify(
            error,
          )}`,
        );
        // Continue to next handler (if any)
      }
    }

    // Delete message only if at least one handler processed it successfully
    if (messageProcessedSuccessfully) {
      try {
        await this.sqsService.deleteMessage(poller.queueUrl, message);
        this.logger.debug(
          `Deleted message ${message.MessageId} from queue ${poller.queueUrl}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to delete message ${message.MessageId} from queue ${poller.queueUrl} with error ${JSON.stringify(
            error,
          )}`,
        );
      }
    } else {
      this.logger.warn(
        `No handler successfully processed message ${message.MessageId}. Message will remain in queue.`,
      );
    }
  }
}
