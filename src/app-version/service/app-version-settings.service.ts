import { Injectable } from '@nestjs/common';
import { SettingsShared } from 'src/settings/service/settings.shared';
import {
  CreateAppVersionSettingsDto,
  UpdateAppVersionSettingsDto,
} from '../dto/app-version-settings.dto';
import { GlobalSettings } from 'src/settings/entity/global-settings.entity';
import { MinimumVersionResponseDto } from '../dto/minimum-version-response.dto';

@Injectable()
export class AppVersionSettingsService {
  constructor(private readonly settingsShared: SettingsShared) {}

  async createAppVersionSettings(
    createAppVersionSettingsDto: CreateAppVersionSettingsDto,
  ): Promise<{ data: GlobalSettings[] }> {
    return this.settingsShared.createGlobalSettings(
      createAppVersionSettingsDto,
    );
  }

  async updateAppVersionSettings(
    updateAppVersionSettingsDto: UpdateAppVersionSettingsDto,
  ): Promise<{ data: GlobalSettings[] }> {
    return this.settingsShared.updateGlobalSettings(
      updateAppVersionSettingsDto,
    );
  }

  async getAppVersionSettings(
    name: string,
  ): Promise<MinimumVersionResponseDto> {
    return this.settingsShared.getGlobalSettings(name);
  }
}
