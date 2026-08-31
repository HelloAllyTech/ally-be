import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { MobileReleasesController } from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

@Module({
  imports: [AppConfigModule],
  controllers: [MobileReleasesController],
  providers: [MobileReleasesService],
  exports: [MobileReleasesService],
})
export class MobileReleasesModule {}
