import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { AppConfigModule } from '../config/config.module';
import { AwsLogsController } from './aws-logs.controller';
import { LogsService } from './logs.service';

@Module({
  imports: [AwsModule, AppConfigModule],
  controllers: [AwsLogsController],
  providers: [LogsService],
})
export class LogsModule {}
