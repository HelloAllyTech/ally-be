import { Module } from '@nestjs/common';
import { SettingsService } from './service/settings.service';
import { SettingsController } from './controller/settings.controller';
import { RedisModule } from 'src/redis/redis.module';
import { PreferenceService } from './service/preference.service';
import { PreferenceRepository } from './repository/preference.repository';

@Module({
  imports: [RedisModule],
  providers: [SettingsService, PreferenceService, PreferenceRepository],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
