import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { RoomMetadataStoreService } from '../service/room-metadata-store.service';

/**
 * Webhook (API-key only) for the voice agent to fetch the full room-metadata
 * envelope by room name. The slim `metadataFetch.url` in LiveKit room/dispatch
 * metadata points here (see RoomMetadataStoreService). Mirrors the roleplay v2
 * spec-versions webhook.
 */
@Controller({ path: 'learn/webhook', version: '1' })
@ApiTags('Learn Room Metadata Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class RoomMetadataWebhookController {
  constructor(
    private readonly roomMetadataStoreService: RoomMetadataStoreService,
  ) {}

  @Get('room-metadata/:roomName')
  @ApiOperation({
    summary:
      'Fetch the full room-metadata envelope for a LiveKit room (API key only)',
  })
  @ApiResponse({ status: 200, description: 'Full room-metadata envelope' })
  @ApiResponse({ status: 404, description: 'Unknown or expired room' })
  getRoomMetadata(
    @Param('roomName') roomName: string,
  ): Promise<Record<string, any>> {
    return this.roomMetadataStoreService.getRoomMetadata(roomName);
  }
}
