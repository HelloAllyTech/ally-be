import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { BuilderPipelineController } from './builder-pipeline.controller';
import { BuilderBuildService } from '../service/builder-build.service';
import { RecordBuilderRunModelDto } from '../dto/builder-pipeline.dto';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderSteerService } from '../service/builder-steer.service';
import { BuilderQuestionService } from '../service/builder-question.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderReportService } from '../service/builder-report.service';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderExemplarService } from '../service/builder-exemplar.service';
import { BuilderEpicService } from '../service/builder-epic.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import {
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';

describe('BuilderPipelineController', () => {
  let app: INestApplication;
  let mockBuilderBuildService: Partial<BuilderBuildService>;

  beforeEach(async () => {
    mockBuilderBuildService = {
      getRunOrFail: jest.fn().mockResolvedValue({
        id: uuidv4(),
        sessionId: uuidv4(),
        engine: null,
        model: null,
      }),
      recordRunModel: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BuilderPipelineController],
      providers: [
        { provide: BuilderBuildService, useValue: mockBuilderBuildService },
        { provide: AppConfigService, useValue: { apiKey: 'test-api-key' } },
        {
          provide: LoggerService,
          useValue: {
            getInstance: () => ({
              warn: jest.fn(),
              error: jest.fn(),
              info: jest.fn(),
            }),
          },
        },
        { provide: PromptSharedService, useValue: {} },
        { provide: BuilderEventService, useValue: {} },
        { provide: BuilderSteerService, useValue: {} },
        { provide: BuilderQuestionService, useValue: {} },
        { provide: BuilderPullRequestService, useValue: {} },
        { provide: BuilderReportService, useValue: {} },
        { provide: BuilderSettingsService, useValue: {} },
        { provide: BuilderExemplarService, useValue: {} },
        { provide: BuilderEpicService, useValue: {} },
        { provide: BuilderKnowledgeService, useValue: {} },
        { provide: BuilderPrdService, useValue: {} },
        { provide: BuilderSessionService, useValue: {} },
        { provide: BuilderBuildRunRepository, useValue: {} },
        { provide: BuilderQuestionRepository, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should record the engine and model for a run', async () => {
    const runId = uuidv4();
    const engine = 'test-engine';
    const model = 'test-model';
    const mockRun = await mockBuilderBuildService.getRunOrFail(runId);

    const dto: RecordBuilderRunModelDto = { engine, model };

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/model`)
      .set('x-api-key', 'test-api-key') // Add API key for authentication
      .send(dto)
      .expect(201)
      .expect({ ok: true });

    expect(mockBuilderBuildService.getRunOrFail).toHaveBeenCalledWith(runId);
    expect(mockBuilderBuildService.recordRunModel).toHaveBeenCalledWith(
      mockRun,
      dto,
    );
  });
});
