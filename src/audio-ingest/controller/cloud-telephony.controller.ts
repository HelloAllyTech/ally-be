import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CloudTelephonyService } from '../service/cloud-telephony.service';
import {
  CloudTelephonyIntegrationResponseDto,
  CreateCloudTelephonyIntegrationDto,
} from '../dto/cloud-telephony.dto';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';

@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Cloud Telephony')
@Controller('v1/cloud-telephony-integration')
export class CloudTelephonyController {
  constructor(private readonly cloudTelephonyService: CloudTelephonyService) {}

  @Post()
  @AuthRoles(UserRole.SUPER_ADMIN)
  async createCloudTelephonyIntegration(
    @Body()
    createCloudTelephonyIntegrationDto: CreateCloudTelephonyIntegrationDto,
  ): Promise<CloudTelephonyIntegrationResponseDto> {
    return this.cloudTelephonyService.createCloudTelephonyIntegration(
      createCloudTelephonyIntegrationDto,
    );
  }
}
