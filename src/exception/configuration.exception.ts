import { InternalServerErrorException, HttpStatus } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { ErrorCode } from './error-code.enum';
import { FAILURE_MESSAGES } from './failure-messages';

const logger = LoggerService.getInstance('Configuration');

/**
 * A required deployment setting is missing or blank.
 *
 * WHY THIS TYPE EXISTS
 * --------------------
 * Several services threw `new InternalServerErrorException(
 * 'The WhatsApp inbound queue is not configured (SQS_WHATSAPP_INBOUND_QUEUE_URL).')`
 * — and `CustomExceptionFilter` passes an HttpException's message straight to
 * the client, so the exact environment variable name was being handed to
 * whoever made the request. That is free reconnaissance: it names the
 * infrastructure, confirms which integrations exist, and tells an attacker
 * precisely which setting to probe for a misconfiguration.
 *
 * The trade-off it was solving is real, though — the original comment on the
 * ingest producer is right that a document sitting at `pending` forever with no
 * explanation is the worst outcome. So nothing is silenced: the variable name is
 * logged at ERROR on construction, where an operator will see it, and the client
 * gets a generic sentence plus `CONFIGURATION_ERROR`, which is enough for it to
 * stop retrying and say "not available" rather than "try again".
 *
 * @param detail Operator-facing text. SAFE to name env vars, queues, buckets —
 *               it is logged, never returned.
 */
export class ConfigurationException extends InternalServerErrorException {
  constructor(detail: string) {
    super({
      message: FAILURE_MESSAGES.CONFIGURATION_ERROR,
      error: 'Internal Server Error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCode.CONFIGURATION_ERROR,
    });
    // Logged from the constructor rather than at each throw site so it cannot
    // be forgotten — the whole point is that the detail must not simply vanish.
    logger.error(`Missing or invalid configuration: ${detail}`);
  }
}
