import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Preference } from './entities/preference.entity';
import { PreferenceService } from './service/preference.service';
import { RedisModule } from '../redis/redis.module';
import { Place } from './entities/place.entity';
import { PlaceService } from './service/place.service';
import { PlaceController } from './controller/place.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Preference, Place]), RedisModule],
  providers: [PreferenceService, PlaceService],
  controllers: [PlaceController],
  exports: [PreferenceService, PlaceService],
})
export class CommonModule {}
