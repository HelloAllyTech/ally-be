import { Module } from '@nestjs/common';
import { AppVersionController } from './controller/app-version.controller';
import { SettingsModule } from 'src/settings/settings.module';
import { AppVersionSettingsService } from './service/app-version-settings.service';

@Module({
  imports: [SettingsModule],
  controllers: [AppVersionController],
  providers: [AppVersionSettingsService],
  exports: [AppVersionSettingsService],
})
export class AppVersionModule {}
