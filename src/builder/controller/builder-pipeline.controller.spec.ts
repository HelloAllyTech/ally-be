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
import { BuilderRunMode, BuilderStage } from '../enum/builder.enum';
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

  let mockBuilderSessionService: { getSession: jest.Mock };

  beforeEach(async () => {
    // Defaults to a stage a run may legitimately finish from, so the
    // completion tests that are not about staging stay unaffected.
    mockBuilderSessionService = {
      getSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        currentStage: BuilderStage.FINALISING,
      }),
    };
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
        { provide: BuilderSessionService, useValue: mockBuilderSessionService },
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
   * A plan is not an outcome.
   *
   * On 2026-09-24 a build's PLANNING agent finished its plan and called
   * `complete_run done`. It was accepted — a planner edits no files, so the
   * `changedNothing` exemption waved the gate requirement through — and the
   * run was settled before the coder had started. Thirty-four minutes later
   * the workflow failed with no pull request.
   */
  it('refuses a build that reports done from PLANNING', async () => {
    (mockBuilderSessionService.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      currentStage: BuilderStage.PLANNING,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(409);

    expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
    // Not even asked: the stage settles it before the file check can excuse it.
    expect(mockBuilderBuildService.touchedNoFiles).not.toHaveBeenCalled();
  });

  /**
   * A failure from an early stage is still a failure. The runner reports these
   * from evidence after the agent has gone, and losing one strands the run.
   */
  it('still records a failure reported from PLANNING', async () => {
    (mockBuilderSessionService.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      currentStage: BuilderStage.PLANNING,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'failed', error: 'the planner could not read the PRD' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  /**
   * A REVIEW run has no gate to pass, so requiring one made a correct review
   * impossible to complete.
   *
   * On 2026-09-23 a review of ally-web#694 reported zero findings, approved
   * the pull request, and was then refused its own completion twice and failed
   * by outcome-gate.sh — recorded as a failed run for doing exactly its job,
   * and announced to Slack as one, because BUILD_FAILED is an announced kind.
   */
  it('settles a review that has no gate to pass', async () => {
    (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue({
      id: uuidv4(),
      sessionId: uuidv4(),
      engine: null,
      model: null,
      mode: BuilderRunMode.REVIEW,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
    // The gate is not merely tolerated when absent — it is never asked for.
    expect(mockBuilderBuildService.hasPassingGate).not.toHaveBeenCalled();
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
