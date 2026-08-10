import { Module } from '@nestjs/common';
import { S3Service } from './service/s3.service';
import { AppConfigModule } from '../config/config.module';
import { SqsService } from './service/sqs.service';
import { SqsPollingService } from './service/sqs-polling.service';
import { SESService } from './service/ses.service';
import { CloudWatchLogsService } from './service/cloudwatch-logs.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    S3Service,
    SqsService,
    SqsPollingService,
    SESService,
    CloudWatchLogsService,
  ],
  exports: [
    S3Service,
    SqsService,
    SqsPollingService,
    SESService,
    CloudWatchLogsService,
  ],
})
export class AwsModule {}
