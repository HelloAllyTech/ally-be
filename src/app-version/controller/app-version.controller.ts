import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../../config/config.service';
import { MinimumVersionResponseDto } from '../dto/minimum-version-response.dto';
import { Public } from 'src/auth/decorators/auth.metadata';

@ApiTags('App Version')
@Controller({
  path: 'app-version',
  version: '1',
})
export class AppVersionController {
  constructor(private readonly configService: AppConfigService) {}

  @Public()
  @Get('android')
  @ApiOperation({
    summary: 'Get minimum Android version',
    description:
      'Returns the minimum Android app version required. Clients should compare with their current version and force update if below this.',
  })
  getMinimumAndroidVersion(): MinimumVersionResponseDto {
    return {
      minimumSupportedVersion:
        this.configService.appMinSupportedVersion.android,
    };
  }

  @Public()
  @Get('ios')
  @ApiOperation({
    summary: 'Get minimum iOS version',
    description:
      'Returns the minimum iOS app version required. Clients should compare with their current version and force update if below this.',
  })
  getMinimumIosVersion(): MinimumVersionResponseDto {
    return {
      minimumSupportedVersion: this.configService.appMinSupportedVersion.ios,
    };
  }
}
