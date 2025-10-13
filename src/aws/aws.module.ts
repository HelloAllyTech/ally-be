import { Module } from '@nestjs/common';
import { S3Service } from './service/s3.service';
import { AppConfigModule } from '../config/config.module';
import { SqsService } from './service/sqs.service';
import { SqsPollingService } from './service/sqs-polling.service';

@Module({
  imports: [AppConfigModule],
  providers: [S3Service, SqsService, SqsPollingService],
  exports: [S3Service, SqsService, SqsPollingService],
})
export class AwsModule {}
