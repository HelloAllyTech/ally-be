import { Message } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  SqsDlqListener,
  SqsListener,
} from '../../aws/decorators/sqs-listener.decorator';
import { KbDocumentStatus } from '../enum/knowledge-base.enum';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { KbIngestService } from '../service/kb-ingest.service';
import { KbIngestMessage } from '../type/kb-ingest.type';

/**
 * Drains the knowledge-base ingest queue.
 *
 * The queue URL is read from process.env at DECORATION time, matching every other consumer in the
 * repo (`@SqsListener(process.env.SQS_...!)`). It cannot come from AppConfigService because
 * decorators run at module load, before the Nest container exists.
 */
@Injectable()
export class KbIngestConsumer {
  private readonly logger = LoggerService.getInstance(KbIngestConsumer.name);

  constructor(private readonly ingestService: KbIngestService) {}

  @SqsListener(process.env.SQS_KB_INGEST_QUEUE_URL!)
  async handleIngest(message: Message): Promise<void> {
    if (!message.Body) return;

    let parsed: KbIngestMessage;
    try {
      parsed = JSON.parse(message.Body) as KbIngestMessage;
    } catch {
      // An unparsable message can never succeed on redelivery, so it is dropped rather than left
      // to cycle through the queue until it dead-letters.
      this.logger.error(
        'Discarding an unparsable knowledge-base ingest message',
      );
      return;
    }

    const { documentId, action } = parsed;
    if (!documentId) {
      this.logger.error('Discarding an ingest message with no documentId');
      return;
    }

    this.logger.info(
      `Processing knowledge-base ${action ?? 'ingest'} for document ${documentId}`,
    );

    // Never throws: KbIngestService records every failure on the document row, which is where the
    // admin will look. Throwing here would make SQS redeliver a document that fails identically
    // every time — an encrypted PDF does not become readable on the third attempt — and it would
    // eventually dead-letter while the row still said "extracting". The Retry action re-queues
    // deliberately, which is the correct way for a fixable failure to get another attempt.
    await this.ingestService.run(documentId, action ?? 'ingest');
  }
}

/**
 * DLQ handler.
 *
 * A message only lands here after the queue's maxReceiveCount, which given the consumer above
 * swallows its own failures means something outside the ingest logic went wrong — the process died
 * mid-message, or the handler itself threw. Either way the document is very likely stuck showing an
 * in-progress status it will never leave, so the job here is to make that visible rather than to
 * retry.
 */
@Injectable()
export class KbIngestDlqConsumer {
  private readonly logger = LoggerService.getInstance(KbIngestDlqConsumer.name);

  constructor(private readonly documentRepository: KbDocumentRepository) {}

  @SqsDlqListener(process.env.SQS_KB_INGEST_DLQ_URL!)
  async handleDlq(message: Message): Promise<void> {
    if (!message.Body) return;

    let documentId: string | undefined;
    try {
      documentId = (JSON.parse(message.Body) as KbIngestMessage).documentId;
    } catch {
      this.logger.error('Received an unparsable message on the ingest DLQ');
      return;
    }
    if (!documentId) return;

    this.logger.error(
      `Knowledge-base ingest dead-lettered for document ${documentId}`,
    );

    // Only rewrite a document still in an in-progress state. A document that reached `indexed` on a
    // later attempt must not be flipped back to failed by a late DLQ delivery.
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });
    if (
      !document ||
      document.status === KbDocumentStatus.INDEXED ||
      document.status === KbDocumentStatus.FAILED
    ) {
      return;
    }

    await this.documentRepository.update(
      { id: documentId },
      {
        status: KbDocumentStatus.FAILED,
        statusMessage:
          'Processing stopped unexpectedly and did not finish. Use Retry to try again; if it ' +
          'keeps failing, the file may be too large or malformed.',
      },
    );
  }
}
