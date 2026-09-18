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
      touchedNoFiles: jest.fn().mockResolvedValue(false),
      hasPassingGate: jest.fn().mockResolvedValue(false),
      settleRun: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: BuilderReportService,
          useValue: {
            composeSessionReport: jest.fn().mockResolvedValue(undefined),
          },
        },
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

  /**
   * A `done` the gate cannot corroborate is refused — and the run is left
   * alone. It used to be settled FAILED, on the assumption that such a claim
   * came from an agent about to exit; it also arrives from one that completed
   * too early, mid-pipeline, before the gate it was claiming had run. The run
   * then carried on to a real pull request behind a session already painted
   * red. Anything that does go on to quit is caught by outcome-gate.sh, which
   * settles whatever is still RUNNING when the engine exits.
   */
  it('refuses a done with no passing gate without ending the run', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(409);

    expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
  });

  it('settles a done the gate corroborates', async () => {
    (mockBuilderBuildService.hasPassingGate as jest.Mock).mockResolvedValue(
      true,
    );
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  /**
   * A failure needs no gate behind it — the runner reports these from evidence
   * after the agent has finished, and they must always land.
   */
  it('always records a failure', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'failed', error: 'no pull request was opened' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  it('should record the engine and model for a run', async () => {
    const runId = uuidv4();
    const engine = 'test-engine';
    const model = 'test-model';
    // Non-null asserted: the mock is a Partial<BuilderBuildService>, so every
    // member is optional to the type checker even though this one is always
    // provided in beforeEach. Without it the Docker build fails on a strict
    // type error that ts-jest does not raise.
    const mockRun = await mockBuilderBuildService.getRunOrFail!(runId);

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
