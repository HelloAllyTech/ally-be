import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { AppConfigService } from 'src/config/config.service';
import { ParticipantJoinedHandler } from './handlers/participant-joined.handler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('LiveKit Webhook')
@Controller('v1/webhook/livekit')
export class LivekitWebhookController {
  private readonly logger = new Logger(LivekitWebhookController.name);
  private webhookReceiver?: WebhookReceiver;

  constructor(
    private readonly configService: AppConfigService,
    private readonly participantJoinedHandler: ParticipantJoinedHandler,
  ) {
    this.initializeWebhookReceiver();
  }

  private initializeWebhookReceiver() {
    const { apiKey, apiSecret } = this.configService.livekit;
    if (!apiKey || !apiSecret) {
      this.logger.warn(
        'LiveKit webhook configuration missing. Webhook receiver will not be available.',
      );
      return;
    }

    this.webhookReceiver = new WebhookReceiver(apiKey, apiSecret);
    this.logger.log('LiveKit webhook receiver initialized');
  }

  @Post('call-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle LiveKit events subscription' })
  @ApiResponse({
    status: 200,
    description: 'LiveKit events subscription processed successfully',
  })
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      if (!this.webhookReceiver) {
        this.logger.error('Webhook receiver not initialized');
        return res
          .status(HttpStatus.SERVICE_UNAVAILABLE)
          .send('Webhook service unavailable');
      }

      const authHeader = req.headers['authorization'] as string;

      // Get raw body data for webhook verification
      const rawBody = await this.getRawBody(req);
      const event = await this.webhookReceiver.receive(rawBody, authHeader);

      this.logger.log(`Received LiveKit webhook event: ${event.event}`);

      // Process the event based on its type
      await this.processWebhookEvent(event);

      res.status(HttpStatus.OK).send();
    } catch (error) {
      this.logger.error('Error processing LiveKit webhook:', error.message);
      res.status(HttpStatus.BAD_REQUEST).send('Invalid webhook');
    }
  }

  private async getRawBody(req: Request): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
  }

  private async processWebhookEvent(event: any) {
    try {
      switch (event.event) {
        case 'participant_joined':
          await this.handleParticipantJoined(event);
          break;
      }
    } catch (error) {
      this.logger.error(`Error processing event ${event.event}:`, error);
    }
  }

  private async handleParticipantJoined(event: any) {
    this.logger.log(
      `Participant joined: ${event.participant?.identity} in room ${event.room?.name}`,
    );

    try {
      await this.participantJoinedHandler.handle(event);
    } catch (error) {
      this.logger.error(
        `Error in participant_joined handler: ${error.message}`,
        error.stack,
      );
    }
  }
}
