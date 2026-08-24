import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { ConfigurationException } from 'src/exception/configuration.exception';
import { LoggerService } from 'src/logger/logger.service';
import { SqsService } from '../../aws/service/sqs.service';
import { InboundWhatsAppMessage } from '../type/whatsapp-provider.interface';

@Injectable()
export class WhatsAppInboundProducer {
  private readonly logger = LoggerService.getInstance(
    WhatsAppInboundProducer.name,
  );

  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Queue one inbound message for processing.
   *
   * A STANDARD queue, not FIFO. Deduplication lives in Postgres (the unique index on
   * `provider_message_id`), and FIFO's own dedupe window is five minutes — far shorter than Meta's
   * retry window, so it would not prevent the duplicate that actually matters. FIFO would also
   * serialise processing across all senders for no benefit, since two different workers' questions
   * have no ordering relationship. If strict per-contact ordering is ever needed, FIFO with
   * MessageGroupId = the phone number is the change.
   *
   * The phone number goes into the message body, so queue retention is a real (if short-lived)
   * exposure of identifiable data — worth keeping the queue's retention low and its encryption on.
   */
  async enqueue(message: InboundWhatsAppMessage): Promise<void> {
    const queueUrl = this.configService.sqs.whatsapp.inboundQueueUrl;
    if (!queueUrl) {
      // The env var name is logged by ConfigurationException, not returned:
      // this endpoint is reached from Meta's webhook, i.e. the public internet.
      throw new ConfigurationException(
        'The WhatsApp inbound queue is not configured (SQS_WHATSAPP_INBOUND_QUEUE_URL).',
      );
    }

    // The message id is logged, never the phone number or the question text — both are PII/PHI and
    // this logger is not the audit path.
    this.logger.info(
      `Queueing inbound WhatsApp message ${message.providerMessageId}`,
    );
    await this.sqsService.sendMessage(queueUrl, message);
  }
}
