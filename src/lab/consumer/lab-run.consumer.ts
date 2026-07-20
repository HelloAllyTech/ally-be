import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsListener } from 'src/aws/decorators/sqs-listener.decorator';
import { LoggerService } from 'src/logger/logger.service';
import { LabRunService } from '../service/lab-run.service';
import { LabRunMessage } from '../producer/lab-run.producer';

/**
 * Executes queued AI Lab runs. The handler re-throws on failure so SQS
 * redelivers (and eventually routes to the DLQ) rather than silently dropping
 * the run. Terminal DLQ handling marks the run FAILED so it never dangles in
 * PENDING/RUNNING.
 */
@Injectable()
export class LabRunConsumer {
  private readonly logger = LoggerService.getInstance(LabRunConsumer.name);

  constructor(private readonly runService: LabRunService) {}

  @SqsListener(process.env.SQS_LAB_RUN_QUEUE_URL!)
  async handleLabRun(message: Message): Promise<void> {
    if (!message.Body) return;
    const { runId } = JSON.parse(message.Body) as LabRunMessage;
    if (!runId) {
      this.logger.error('[AI_LAB] lab_run message missing runId');
      return;
    }
    // Throwing keeps the message on the queue for SQS retry/DLQ.
    await this.runService.execute(runId);
  }

  @SqsListener(process.env.SQS_LAB_RUN_DLQ_URL!)
  async handleLabRunDlq(message: Message): Promise<void> {
    if (!message.Body) return;
    const { runId } = JSON.parse(message.Body) as LabRunMessage;
    if (!runId) return;
    this.logger.error(
      `[AI_LAB] run ${runId} exhausted retries — marking FAILED`,
    );
    await this.runService.markFailed(
      runId,
      'Execution failed after retries (dead-lettered).',
    );
  }
}
