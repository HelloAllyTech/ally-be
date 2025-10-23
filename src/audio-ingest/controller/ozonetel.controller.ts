import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import {
  SubscribeOzonetelEvents,
  UnsubscribeOzonetelEvents,
} from '../decorator/api-documentation.decorator';
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

  @SubscribeOzonetelEvents()
  @Post('subscribe-events')
  @AuthPermissions([PERMISSIONS.SUBSCRIBE_OZONETEL_EVENTS])
  async handleOzonetelCallDetails(
    @Body() ozonetelSubscriptionDto: OzonetelSubscriptionDto,
  ) {
    return this.ozonetelService.subscribeOzonetelEvents(
      ozonetelSubscriptionDto.tenantId,
    );
  }

  @UnsubscribeOzonetelEvents()
  @Post('unsubscribe-events')
  @AuthPermissions([PERMISSIONS.UNSUBSCRIBE_OZONETEL_EVENTS])
  async handleOzonetelUnsubscribe(
    @Body() ozonetelUnsubscriptionDto: OzonetelUnsubscriptionDto,
  ) {
    return this.ozonetelService.unsubscribeOzonetelEvents(
      ozonetelUnsubscriptionDto.tenantId,
    );
  }
}
