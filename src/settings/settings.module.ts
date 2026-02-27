import { Module } from '@nestjs/common';
import { SettingsService } from './service/settings.service';
import { SettingsController } from './controller/settings.controller';
import { RedisModule } from 'src/redis/redis.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Preference } from './entity/preference.entity';
import { PreferenceService } from './service/preference.service';
import { PreferenceRepository } from './repository/preference.repository';
import { GlobalSettingsRepository } from './repository/global-settings.repository';
import { SettingsShared } from './service/settings.shared';

@Module({
  imports: [TypeOrmModule.forFeature([Preference]), RedisModule],
  providers: [
    SettingsService,
    PreferenceService,
    PreferenceRepository,

    GlobalSettingsRepository,
    SettingsShared,
  ],
  controllers: [SettingsController],
  exports: [SettingsService, PreferenceService, SettingsShared],
})
export class SettingsModule {}
