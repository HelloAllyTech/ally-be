import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LogsService } from './logs.service';
import {
  AwsLogsQueryDto,
  AwsLogStreamsQueryDto,
  AwsLogsResponseDto,
  AwsLogStreamsResponseDto,
} from './dto/aws-logs.dto';

/**
 * AWS CloudWatch Logs viewer for the 3 backend services. Gated ONLY to
 * SUPER_DUPER_ADMIN (view:aws-logs, migration 1887000000000) — these
 * services' logs can carry sensitive request data.
 */
@Controller('v1/aws-logs')
@ApiTags('AWS Logs')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AwsLogsController {
  constructor(private readonly logsService: LogsService) {}

  @ApiOperation({ summary: 'Search CloudWatch log events for a service' })
  @ApiResponse({ status: 200, type: AwsLogsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_AWS_LOGS])
  @Get()
  getLogEvents(@Query() query: AwsLogsQueryDto): Promise<AwsLogsResponseDto> {
    return this.logsService.getLogEvents(query);
  }

  @ApiOperation({ summary: 'List recent CloudWatch log streams for a service' })
  @ApiResponse({ status: 200, type: AwsLogStreamsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_AWS_LOGS])
  @Get('streams')
  listLogStreams(
    @Query() query: AwsLogStreamsQueryDto,
  ): Promise<AwsLogStreamsResponseDto> {
    return this.logsService.listLogStreams(query);
  }
}
