import { Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { SqsService } from 'src/aws/service/sqs.service';

/** Message enqueued for a single AI Lab run execution. */
export interface LabRunMessage {
  message_type: 'lab_run_execute';
  runId: string;
}

@Injectable()
export class LabRunProducer {
  private readonly logger = LoggerService.getInstance(LabRunProducer.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: AppConfigService,
  ) {}

  /** True when the lab-run queue is provisioned in this environment. */
  isEnabled(): boolean {
    return !!this.configService.sqs.labRun.queueUrl;
  }

  /**
   * Enqueue a run for async execution. Returns false (does not throw) when the
   * queue isn't configured, so the caller can fall back to synchronous
   * execution.
   */
  async enqueue(runId: string): Promise<boolean> {
    const queueUrl = this.configService.sqs.labRun.queueUrl;
    if (!queueUrl) return false;
    await this.sqsService.sendMessage(queueUrl, {
      message_type: 'lab_run_execute',
      runId,
    } satisfies LabRunMessage);
    this.logger.info(`[AI_LAB] enqueued run ${runId} for async execution`);
    return true;
  }
}
