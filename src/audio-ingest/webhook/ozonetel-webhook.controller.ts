import {
  Body,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LoggerService } from '../../logger/logger.service';
import { OzonetelService } from '../service/ozonetel.service';
import {
  OzonetelCallDetailsBody,
  OzonetelCallDetails,
} from '../type/ozonetel.type';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Ozonetel Webhook')
@Controller('v1/webhook/ozonetel')
export class OzonetelWebhookController {
  private readonly logger = LoggerService.getInstance(
    OzonetelWebhookController.name,
  );

  constructor(private readonly ozonetelService: OzonetelService) {}

  @Post('call-details')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Ozonetel call details webhook' })
  @ApiResponse({
    status: 200,
    description: 'Ozonetel call details processed successfully',
  })
  @AuthPermissions([PERMISSIONS.PROCESS_OZONETEL_WEBHOOK])
  async handleOzonetelCallDetails(
    @Query('code') code: string,
    @Body() body: OzonetelCallDetailsBody,
  ) {
    try {
      this.logger.info('Received Ozonetel call details webhook');
      const parsedData: OzonetelCallDetails = JSON.parse(body.data);
      this.ozonetelService.processOzonetelCallDetail(parsedData, code);
      return { success: true, message: 'Webhook processed successfully' };
    } catch (error) {
      this.logger.error(
        `Error processing Ozonetel webhook with error ${JSON.stringify(error)}`,
      );
      throw new BadRequestException('Failed to process webhook');
    }
  }

  @Post('call-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Ozonetel events subscription' })
  @ApiResponse({
    status: 200,
    description: 'Ozonetel events subscription processed successfully',
  })
  @AuthPermissions([PERMISSIONS.PROCESS_OZONETEL_WEBHOOK])
  async handleOzonetelEventsSubscription(
    @Query('code') code: string,
    @Body() body: any,
  ) {
    try {
      this.logger.info('Received Ozonetel events subscription');
      this.ozonetelService.handleOzonetelCallEvents(body, code);

      return {
        success: true,
        message: 'Events subscription processed successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error processing Ozonetel events subscription with error ${JSON.stringify(
          error,
        )}`,
      );
      throw new BadRequestException('Failed to process events subscription');
    }
  }
}
