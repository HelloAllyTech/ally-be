import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantJoinedHandler } from './handlers/participant-joined.handler';
import { RoomFinishedHandler } from './handlers/room-finished.handler';

@ApiTags('LiveKit Webhook')
@Controller('v1/webhook/livekit')
export class LivekitWebhookController {
  private readonly logger = LoggerService.getInstance(
    LivekitWebhookController.name,
  );
  private webhookReceiver?: WebhookReceiver;

  constructor(
    private readonly configService: AppConfigService,
    private readonly participantJoinedHandler: ParticipantJoinedHandler,
    private readonly roomFinishedHandler: RoomFinishedHandler,
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
    this.logger.debug('LiveKit webhook receiver initialized');
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
      this.logger.info(`'rawBody handleWebhook '${rawBody}`);
      const parsedBody = this.parseJsonBody(rawBody);
      const roomMetadata = this.parseMetadata(parsedBody?.room?.metadata);

      if (
        roomMetadata?.environment !== this.configService.livekit.environment
      ) {
        return res.status(HttpStatus.OK).send();
      }

      const event = await this.webhookReceiver.receive(rawBody, authHeader);
      this.logger.info(`${event},'event handleWebhook`);

      this.logger.debug(`Received LiveKit webhook event: ${event.event}`);

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

  private parseJsonBody(rawBody: string): Record<string, any> | null {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  }

  private parseMetadata(metadata: unknown): Record<string, any> | null {
    if (typeof metadata === 'string') {
      try {
        const parsed = JSON.parse(metadata) as unknown;
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, any>)
          : null;
      } catch {
        return null;
      }
    }

    return typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, any>)
      : null;
  }

  private async processWebhookEvent(event: any) {
    try {
      switch (event.event) {
        case 'participant_joined':
          await this.handleParticipantJoined(event);
          break;
        case 'room_finished':
          await this.handleRoomFinished(event);
          break;
      }
    } catch (error) {
      this.logger.error(`Error processing event ${event.event}:`, error);
    }
  }

  private async handleParticipantJoined(event: any) {
    this.logger.debug(
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

  private async handleRoomFinished(event: any) {
    this.logger.debug(`Room finished: ${event.room?.name}`);

    try {
      await this.roomFinishedHandler.handle(event);
    } catch (error) {
      this.logger.error(`Error in room_finished handler: ${error.message}`);
    }
  }
}
