import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudWatchLogsService } from '../aws/service/cloudwatch-logs.service';
import { AppConfigService, AwsLogServiceKey } from '../config/config.service';
import {
  AwsLogsQueryDto,
  AwsLogStreamsQueryDto,
  AwsLogsResponseDto,
  AwsLogStreamsResponseDto,
} from './dto/aws-logs.dto';

@Injectable()
export class LogsService {
  constructor(
    private readonly cloudWatchLogsService: CloudWatchLogsService,
    private readonly config: AppConfigService,
  ) {}

  private resolveLogGroup(service: AwsLogServiceKey): string {
    const logGroupName = this.config.awsLogs.logGroups[service];
    if (!logGroupName) {
      throw new BadRequestException(
        `No CloudWatch log group configured for "${service}". Set the corresponding AWS_LOG_GROUP_* env var.`,
      );
    }
    return logGroupName;
  }

  /**
   * CloudWatch's plain-text filter pattern ANDs quoted terms together. There
   * is no native "level" field for non-JSON logs, so a level filter is just a
   * quoted substring match against the log level token in the line.
   */
  private buildFilterPattern(params: {
    level?: string;
    search?: string;
  }): string | undefined {
    const terms: string[] = [];
    if (params.level) terms.push(`"${params.level}"`);
    if (params.search) terms.push(`"${params.search.replace(/"/g, '')}"`);
    return terms.length > 0 ? terms.join(' ') : undefined;
  }

  async getLogEvents(query: AwsLogsQueryDto): Promise<AwsLogsResponseDto> {
    const logGroupName = this.resolveLogGroup(query.service);
    const filterPattern = this.buildFilterPattern({
      level: query.level,
      search: query.search,
    });

    const { events, nextToken } =
      await this.cloudWatchLogsService.filterLogEvents({
        logGroupName,
        startTime: query.startTime,
        endTime: query.endTime,
        filterPattern,
        logStreamNamePrefix: query.logStreamName,
        nextToken: query.nextToken,
        limit: query.limit,
      });

    return {
      events: events.map((event) => ({
        timestamp: event.timestamp ?? 0,
        message: event.message ?? '',
        logStreamName: event.logStreamName ?? '',
        eventId: event.eventId ?? '',
      })),
      nextToken,
    };
  }

  async listLogStreams(
    query: AwsLogStreamsQueryDto,
  ): Promise<AwsLogStreamsResponseDto> {
    const logGroupName = this.resolveLogGroup(query.service);

    const { streams, nextToken } =
      await this.cloudWatchLogsService.listLogStreams({
        logGroupName,
        nextToken: query.nextToken,
      });

    return {
      streams: streams.map((stream) => ({
        name: stream.logStreamName ?? '',
        lastEventTime: stream.lastEventTimestamp,
      })),
      nextToken,
    };
  }
}
