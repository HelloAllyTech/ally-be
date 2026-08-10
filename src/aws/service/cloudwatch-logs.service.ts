import { Injectable } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  CloudWatchLogsClientConfig,
  FilterLogEventsCommand,
  FilteredLogEvent,
  DescribeLogStreamsCommand,
  LogStream,
} from '@aws-sdk/client-cloudwatch-logs';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class CloudWatchLogsService {
  private readonly client: CloudWatchLogsClient;

  constructor(config: AppConfigService) {
    const { region, accessKeyId, secretAccessKey, sessionToken, endpointUrl } =
      config.aws;
    const clientConfig: CloudWatchLogsClientConfig = { region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken && { sessionToken }),
      };
    }
    if (endpointUrl) {
      clientConfig.endpoint = endpointUrl;
    }
    this.client = new CloudWatchLogsClient(clientConfig);
  }

  async filterLogEvents(params: {
    logGroupName: string;
    startTime: number;
    endTime: number;
    filterPattern?: string;
    logStreamNamePrefix?: string;
    nextToken?: string;
    limit?: number;
  }): Promise<{ events: FilteredLogEvent[]; nextToken?: string }> {
    const {
      logGroupName,
      startTime,
      endTime,
      filterPattern,
      logStreamNamePrefix,
      nextToken,
      limit,
    } = params;

    try {
      const result = await this.client.send(
        new FilterLogEventsCommand({
          logGroupName,
          startTime,
          endTime,
          ...(filterPattern && { filterPattern }),
          ...(logStreamNamePrefix && { logStreamNamePrefix }),
          ...(nextToken && { nextToken }),
          limit,
        }),
      );
      return {
        events: result.events ?? [],
        nextToken: result.nextToken,
      };
    } catch (error) {
      throw new Error(`Failed to filter log events: ${error.message}`);
    }
  }

  async listLogStreams(params: {
    logGroupName: string;
    nextToken?: string;
  }): Promise<{ streams: LogStream[]; nextToken?: string }> {
    const { logGroupName, nextToken } = params;

    try {
      const result = await this.client.send(
        new DescribeLogStreamsCommand({
          logGroupName,
          orderBy: 'LastEventTime',
          descending: true,
          ...(nextToken && { nextToken }),
        }),
      );
      return {
        streams: result.logStreams ?? [],
        nextToken: result.nextToken,
      };
    } catch (error) {
      throw new Error(`Failed to list log streams: ${error.message}`);
    }
  }
}
