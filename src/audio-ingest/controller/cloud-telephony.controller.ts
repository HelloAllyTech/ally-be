import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CloudTelephonyService } from '../service/cloud-telephony.service';
import {
  CloudTelephonyIntegrationResponseDto,
  CreateCloudTelephonyIntegrationDto,
} from '../dto/cloud-telephony.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Cloud Telephony')
@Controller('v1/cloud-telephony-integration')
export class CloudTelephonyController {
  constructor(private readonly cloudTelephonyService: CloudTelephonyService) {}

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_CLOUD_TELEPHONY])
  async createCloudTelephonyIntegration(
    @Body()
    createCloudTelephonyIntegrationDto: CreateCloudTelephonyIntegrationDto,
  ): Promise<CloudTelephonyIntegrationResponseDto> {
    return this.cloudTelephonyService.createCloudTelephonyIntegration(
      createCloudTelephonyIntegrationDto,
    );
  }
}
