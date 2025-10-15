import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { OzonetelService } from '../service/ozonetel.service';

import {
  OzonetelSubscriptionDto,
  OzonetelUnsubscriptionDto,
} from '../dto/ozonetel.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/ozonetel')
export class OzonetelController {
  constructor(private readonly ozonetelService: OzonetelService) {}

  @Post('subscribe-events')
  @AuthPermissions([PERMISSIONS.SUBSCRIBE_OZONETEL_EVENTS])
  @ApiOperation({ summary: 'Subscribe Ozonetel events' })
  async handleOzonetelCallDetails(
    @Body() ozonetelSubscriptionDto: OzonetelSubscriptionDto,
  ) {
    return this.ozonetelService.subscribeOzonetelEvents(
      ozonetelSubscriptionDto.tenantId,
    );
  }

  @Post('unsubscribe-events')
  @AuthPermissions([PERMISSIONS.UNSUBSCRIBE_OZONETEL_EVENTS])
  @ApiOperation({ summary: 'Unsubscribe Ozonetel events' })
  async handleOzonetelUnsubscribe(
    @Body() ozonetelUnsubscriptionDto: OzonetelUnsubscriptionDto,
  ) {
    return this.ozonetelService.unsubscribeOzonetelEvents(
      ozonetelUnsubscriptionDto.tenantId,
    );
  }
}
