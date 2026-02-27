import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { Public } from 'src/auth/decorators/auth.metadata';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateAppVersionSettingsDto,
  UpdateAppVersionSettingsDto,
} from '../dto/app-version-settings.dto';
import { AppVersionSettingsService } from '../service/app-version-settings.service';
import { MinimumVersionResponseDto } from '../dto/minimum-version-response.dto';

@ApiTags('App Version')
@Controller({
  path: 'app-version',
  version: '1',
})
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AppVersionController {
  constructor(
    private readonly appVersionSettingsService: AppVersionSettingsService,
  ) {}

  @Public()
  @Get('android')
  @ApiOperation({
    summary: 'Get minimum Android version',
    description:
      'Returns the minimum Android app version required. Clients should compare with their current version and force update if below this.',
  })
  getMinimumAndroidVersion(): Promise<MinimumVersionResponseDto> {
    return this.appVersionSettingsService.getAppVersionSettings('android');
  }

  @Public()
  @Get('ios')
  @ApiOperation({
    summary: 'Get minimum iOS version',
    description:
      'Returns the minimum iOS app version required. Clients should compare with their current version and force update if below this.',
  })
  getMinimumIosVersion(): Promise<MinimumVersionResponseDto> {
    return this.appVersionSettingsService.getAppVersionSettings('ios');
  }

  @Post('app-version')
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  @ApiOperation({ summary: 'Create global settings' })
  async createAppVersionSettings(
    @Body() createAppVersionSettingsDto: CreateAppVersionSettingsDto,
  ) {
    return this.appVersionSettingsService.createAppVersionSettings(
      createAppVersionSettingsDto,
    );
  }

  @Put('app-version')
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  @ApiOperation({ summary: 'Update global settings' })
  async updateAppVersionSettings(
    @Body() updateAppVersionSettingsDto: UpdateAppVersionSettingsDto,
  ) {
    return this.appVersionSettingsService.updateAppVersionSettings(
      updateAppVersionSettingsDto,
    );
  }
}
