import { Test, TestingModule } from '@nestjs/testing';
import { AwsLogsController } from '../aws-logs.controller';
import { LogsService } from '../logs.service';
import { AwsLogsQueryDto, AwsLogStreamsQueryDto } from '../dto/aws-logs.dto';

jest.mock('../../auth/decorators/feature-toggle.decorator', () => ({
  RequireFeatureToggle: () => () => {},
}));

describe('AwsLogsController', () => {
  let controller: AwsLogsController;
  let logsService: jest.Mocked<LogsService>;

  beforeEach(async () => {
    logsService = {
      getLogEvents: jest.fn(),
      listLogStreams: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AwsLogsController],
      providers: [{ provide: LogsService, useValue: logsService }],
    }).compile();

    controller = module.get<AwsLogsController>(AwsLogsController);
  });

  it('delegates getLogEvents to LogsService', async () => {
    const query: AwsLogsQueryDto = {
      service: 'ally-be',
      startTime: 1000,
      endTime: 2000,
      limit: 200,
    };
    const response = { events: [], nextToken: undefined };
    logsService.getLogEvents.mockResolvedValue(response);

    const result = await controller.getLogEvents(query);

    expect(logsService.getLogEvents).toHaveBeenCalledWith(query);
    expect(result).toBe(response);
  });

  it('delegates listLogStreams to LogsService', async () => {
    const query: AwsLogStreamsQueryDto = { service: 'ally-ai-learn' };
    const response = { streams: [], nextToken: undefined };
    logsService.listLogStreams.mockResolvedValue(response);

    const result = await controller.listLogStreams(query);

    expect(logsService.listLogStreams).toHaveBeenCalledWith(query);
    expect(result).toBe(response);
  });
});
