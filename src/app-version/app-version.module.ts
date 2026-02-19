import { Module } from '@nestjs/common';
import { AppVersionController } from './controller/app-version.controller';

@Module({
  controllers: [AppVersionController],
})
export class AppVersionModule {}
