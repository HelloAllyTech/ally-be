import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import {
  SubscribeOzonetelEvents,
  UnsubscribeOzonetelEvents,
} from '../decorator/api-documentation.decorator';
import { OzonetelService } from '../service/ozonetel.service';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';

import {
  OzonetelSubscriptionDto,
  OzonetelUnsubscriptionDto,
} from '../dto/ozonetel.dto';

@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/ozonetel')
export class OzonetelController {
  constructor(private readonly ozonetelService: OzonetelService) {}

  @SubscribeOzonetelEvents()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('subscribe-events')
  async handleOzonetelCallDetails(
    @Body() ozonetelSubscriptionDto: OzonetelSubscriptionDto,
  ) {
    return this.ozonetelService.subscribeOzonetelEvents(
      ozonetelSubscriptionDto.tenantId,
    );
  }

  @UnsubscribeOzonetelEvents()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('unsubscribe-events')
  async handleOzonetelUnsubscribe(
    @Body() ozonetelUnsubscriptionDto: OzonetelUnsubscriptionDto,
  ) {
    return this.ozonetelService.unsubscribeOzonetelEvents(
      ozonetelUnsubscriptionDto.tenantId,
    );
  }
}
