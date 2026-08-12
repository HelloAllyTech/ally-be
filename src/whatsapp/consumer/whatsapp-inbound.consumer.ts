import { Message } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  SqsDlqListener,
  SqsListener,
} from '../../aws/decorators/sqs-listener.decorator';
import { WaMessage } from '../entity/wa-message.entity';
import { WaMessageStatus } from '../enum/whatsapp.enum';
import { WhatsAppInboundService } from '../service/whatsapp-inbound.service';
import { InboundWhatsAppMessage } from '../type/whatsapp-provider.interface';

/**
 * Drains the WhatsApp inbound queue.
 *
 * Queue URL comes from process.env at DECORATION time, matching every other consumer in the repo —
 * decorators run at module load, before the Nest container exists, so AppConfigService is not
 * available here.
 */
@Injectable()
export class WhatsAppInboundConsumer {
  private readonly logger = LoggerService.getInstance(
    WhatsAppInboundConsumer.name,
  );

  constructor(private readonly inboundService: WhatsAppInboundService) {}

  @SqsListener(process.env.SQS_WHATSAPP_INBOUND_QUEUE_URL!)
  async handleInbound(message: Message): Promise<void> {
    if (!message.Body) return;

    let inbound: InboundWhatsAppMessage;
    try {
      inbound = JSON.parse(message.Body) as InboundWhatsAppMessage;
      // Re-hydrate: JSON has no Date type, so the timestamp arrives as a string.
      inbound.timestamp = inbound.timestamp
        ? new Date(inbound.timestamp)
        : new Date();
    } catch {
      // An unparsable message cannot succeed on redelivery, so it is dropped rather than cycling
      // through the queue to the DLQ.
      this.logger.error('Discarding an unparsable inbound WhatsApp message');
      return;
    }

    if (!inbound.providerMessageId || !inbound.from) {
      this.logger.error(
        'Discarding an inbound message missing its id or sender',
      );
      return;
    }

    // Deliberately NOT wrapped in a try/rethrow. WhatsAppInboundService already guarantees it throws
    // only before it has sent anything, and it records its own failures on the message row. Letting
    // an exception escape here would make SQS redeliver, and a redelivery after a successful send is
    // a second reply to the same worker.
    await this.inboundService.handle(inbound);
  }
}

/**
 * DLQ handler.
 *
 * Records and alerts. It deliberately does NOT retry the send.
 *
 * Meta only permits a free-form reply within 24 hours of the worker's last message (the customer
 * service window). A message that has cycled to the DLQ is minutes or hours old at best, so a
 * replayed reply would either be rejected outright or arrive so late as to be confusing. Making the
 * failure visible is the useful action; answering is not.
 */
@Injectable()
export class WhatsAppInboundDlqConsumer {
  private readonly logger = LoggerService.getInstance(
    WhatsAppInboundDlqConsumer.name,
  );

  constructor(
    @InjectRepository(WaMessage)
    private readonly messageRepository: Repository<WaMessage>,
  ) {}

  @SqsDlqListener(process.env.SQS_WHATSAPP_INBOUND_DLQ_URL!)
  async handleDlq(message: Message): Promise<void> {
    if (!message.Body) return;

    let providerMessageId: string | undefined;
    try {
      providerMessageId = (JSON.parse(message.Body) as InboundWhatsAppMessage)
        .providerMessageId;
    } catch {
      this.logger.error('Received an unparsable message on the WhatsApp DLQ');
      return;
    }
    if (!providerMessageId) return;

    this.logger.error(
      `WhatsApp inbound message dead-lettered: ${providerMessageId}`,
    );

    // Only rewrite a row still mid-flight. A message that was answered on a later attempt must not be
    // flipped to failed by a late DLQ delivery.
    const existing = await this.messageRepository.findOne({
      where: { providerMessageId },
    });
    if (
      !existing ||
      existing.status === WaMessageStatus.SENT ||
      existing.status === WaMessageStatus.DISCARDED
    ) {
      return;
    }

    await this.messageRepository.update(
      { id: existing.id },
      {
        status: WaMessageStatus.FAILED,
        errorMessage:
          'Processing failed repeatedly and was dead-lettered. No reply was sent — Meta only ' +
          'allows a free-form reply within 24 hours of the incoming message.',
      },
    );
  }
}
