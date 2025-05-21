import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Preference } from './entities/preference.entity';
import { PreferenceService } from './service/preference.service';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Preference]), RedisModule],
  providers: [PreferenceService],
  exports: [PreferenceService],
})
export class CommonModule {}
