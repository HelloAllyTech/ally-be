import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { LoggerService } from 'src/logger/logger.service';
import { WhatsAppInboundProducer } from '../producer/whatsapp-inbound.producer';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';

/**
 * The provider's webhook. Public by necessity, authenticated by signature.
 *
 * There is NO guard decorator, and that is deliberate rather than an omission: Meta cannot present a
 * JWT or an API key, so the `X-Hub-Signature-256` HMAC over the raw body IS the authentication. The
 * shape follows livekit-webhook.controller.ts, with one deliberate divergence — that controller reads
 * the raw body by iterating `req`, which cannot work because `express.json` in main.ts has already
 * consumed the stream. This one uses `req.rawBody`, captured by the `verify` hook added there.
 *
 * Excluded from Swagger: it is not a consumer of ours, and publishing the shape of an
 * unauthenticated endpoint invites probing.
 */
@ApiExcludeController()
@Controller('v1/webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = LoggerService.getInstance(
    WhatsAppWebhookController.name,
  );

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly inboundProducer: WhatsAppInboundProducer,
  ) {}

  /**
   * Webhook registration handshake.
   *
   * Meta GETs this once when the webhook URL is saved and expects `hub.challenge` echoed back as
   * plain text. Returns 403 rather than an empty 200 on a bad token, so a misconfigured verify token
   * shows up as a failed registration in Meta's console instead of a webhook that silently never
   * delivers.
   */
  @Get()
  handshake(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): void {
    const challenge = this.provider.verifyWebhookChallenge(query);
    if (challenge === null) {
      res.status(HttpStatus.FORBIDDEN).send();
      return;
    }
    res.status(HttpStatus.OK).type('text/plain').send(challenge);
  }

  /**
   * Inbound message delivery.
   *
   * Does the minimum and returns: verify, parse, enqueue, 200. Everything real happens in the
   * consumer, because Meta retries a webhook it considers failed and its patience is measured in
   * seconds — doing retrieval here would guarantee duplicate deliveries under load.
   *
   * Status codes are chosen carefully:
   *  - 403 on a bad signature. A signature failure is either an attack or a misconfigured
   *    WHATSAPP_APP_SECRET, and both must be loud. A webhook that 200s while answering nobody is the
   *    worst possible failure, because everything looks healthy.
   *  - 200 on every parse or business failure, including an unparsable payload. Those will fail
   *    identically on redelivery, so a retry storm buys nothing.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.provider.verifyRequest(req)) {
      res.status(HttpStatus.FORBIDDEN).send();
      return;
    }

    // Respond first, then enqueue. The provider is waiting on this socket, and an enqueue that takes
    // a moment must not push the response past its timeout and trigger a redelivery.
    res.status(HttpStatus.OK).send();

    try {
      const messages = this.provider.parseInbound(req.body);
      if (!messages.length) {
        // Normal and frequent: delivery receipts, read receipts and status updates all arrive here.
        return;
      }

      for (const message of messages) {
        await this.inboundProducer.enqueue(message);
      }
    } catch (error) {
      // Cannot change the response now, so the failure is recorded loudly instead. Losing an inbound
      // message here is a real (if rare) gap; it is preferable to holding the socket open.
      this.logger.error(
        `Failed to enqueue an inbound WhatsApp message: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
