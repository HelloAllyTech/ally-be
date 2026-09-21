import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { BugHunterPipelineController } from './bug-hunter-pipeline.controller';
import { BugHunterService } from '../service/bug-hunter.service';
import { BugFindingService } from '../service/bug-finding.service';
import { BugHunterFinderDataService } from '../service/bug-hunter-finder-data.service';
import { BugFixSessionService } from '../service/bug-fix-session.service';
import { AppConfigService } from 'src/config/config.service';
import { BugHunterModelSettingsService } from '../service/bug-hunter-model-settings.service';
import { RecordBugHuntRunModelDto } from '../dto/bug-hunter.dto';

describe('BugHunterPipelineController', () => {
  let app: INestApplication;
  let mockBugHunterService: Partial<BugHunterService>;

  beforeEach(async () => {
    mockBugHunterService = {
      recordResolvedModel: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BugHunterPipelineController],
      providers: [
        { provide: BugHunterService, useValue: mockBugHunterService },
        { provide: BugFindingService, useValue: {} },
        { provide: BugHunterFinderDataService, useValue: {} },
        { provide: BugFixSessionService, useValue: {} },
        {
          provide: AppConfigService,
          useValue: {
            publicApiBaseUrl: 'http://localhost',
            apiKey: 'test-api-key',
          },
        },
        { provide: BugHunterModelSettingsService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should 404 the old /pipeline/runs/:id/model route and never call the service', async () => {
    const runId = uuidv4();
    const engine = 'test-bug-hunter-engine';
    const model = 'test-bug-hunter-model';

    const dto: RecordBugHuntRunModelDto = { engine, model };

    await request(app.getHttpServer())
      .post(`/api/v1/bug-hunter/pipeline/runs/${runId}/model`)
      .set('x-api-key', 'test-api-key')
      .send(dto)
      .expect(404);

    expect(mockBugHunterService.recordResolvedModel).not.toHaveBeenCalled();
  });

  it('should successfully record the engine and model via the corrected /runs/:id/model route', async () => {
    const runId = uuidv4();
    const engine = 'test-bug-hunter-engine';
    const model = 'test-bug-hunter-model';

    const dto: RecordBugHuntRunModelDto = { engine, model };

    await request(app.getHttpServer())
      .post(`/api/v1/bug-hunter/runs/${runId}/model`)
      .set('x-api-key', 'test-api-key')
      .send(dto)
      .expect(201)
      .expect(dto);

    expect(mockBugHunterService.recordResolvedModel).toHaveBeenCalledWith(
      runId,
      dto,
    );
  });
});
