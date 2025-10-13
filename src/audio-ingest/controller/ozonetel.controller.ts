import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
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

  @Post('subscribe-events')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Subscribe Ozonetel events' })
  async handleOzonetelCallDetails(
    @Body() ozonetelSubscriptionDto: OzonetelSubscriptionDto,
  ) {
    return this.ozonetelService.subscribeOzonetelEvents(
      ozonetelSubscriptionDto.tenantId,
    );
  }

  @Post('unsubscribe-events')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Unsubscribe Ozonetel events' })
  async handleOzonetelUnsubscribe(
    @Body() ozonetelUnsubscriptionDto: OzonetelUnsubscriptionDto,
  ) {
    return this.ozonetelService.unsubscribeOzonetelEvents(
      ozonetelUnsubscriptionDto.tenantId,
    );
  }
}
