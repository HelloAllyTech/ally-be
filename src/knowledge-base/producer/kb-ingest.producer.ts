import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { ConfigurationException } from 'src/exception/configuration.exception';
import { LoggerService } from 'src/logger/logger.service';
import { SqsService } from '../../aws/service/sqs.service';
import { KbIngestMessage } from '../type/kb-ingest.type';

@Injectable()
export class KbIngestProducer {
  private readonly logger = LoggerService.getInstance(KbIngestProducer.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Queue one document for extraction, chunking and indexing.
   *
   * Enqueued rather than done inline because ingest is minutes of work for a large PDF, and the
   * admin's create request must return immediately with a row they can watch. It also means a
   * transient ally-ai or OpenAI outage costs a redelivery instead of a lost upload.
   *
   * Throws when the queue is unconfigured rather than silently dropping the message: a document
   * that sits at `pending` forever with no explanation is the worst outcome here, because it looks
   * like slow progress rather than a misconfiguration.
   */
  async enqueue(message: KbIngestMessage): Promise<void> {
    const queueUrl = this.configService.sqs.knowledgeBase.ingestQueueUrl;
    if (!queueUrl) {
      // Still throws rather than silently dropping the message — the comment
      // above is right that a document stuck at `pending` with no explanation is
      // the worst outcome. What changed is WHERE the queue's env var name goes:
      // to the log, not to the client.
      throw new ConfigurationException(
        'The knowledge-base ingest queue is not configured (SQS_KB_INGEST_QUEUE_URL).',
      );
    }

    this.logger.info(
      `Queueing knowledge-base ${message.action} for document ${message.documentId}`,
    );
    await this.sqsService.sendMessage(queueUrl, message);
  }
}
