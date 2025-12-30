import { forwardRef, Module } from '@nestjs/common';
import { SettingsService } from './service/settings.service';
import { SettingsController } from './controller/settings.controller';
import { RedisModule } from 'src/redis/redis.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Preference } from './entity/preference.entity';
import { PreferenceService } from './service/preference.service';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Preference]),
    RedisModule,
    forwardRef(() => UserModule),
  ],
  providers: [SettingsService, PreferenceService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
