import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { BugHunterPipelineController } from './bug-hunter-pipeline.controller';
import { BugHunterService } from '../service/bug-hunter.service';
import { BugFindingService } from '../service/bug-finding.service';
import { BugHunterFinderDataService } from '../service/bug-hunter-finder-data.service';
import { BugFixSessionService } from '../service/bug-fix-session.service';
import { AppConfigService } from 'src/config/config.service';
import { BugHunterModelSettingsService } from '../service/bug-hunter-model-settings.service';
import {
  RecordBugHuntRunModelDto,
  PersistBugFindingsDto,
} from '../dto/bug-hunter.dto';
import { BugFindingSource } from '../enum/bug-finding.enum';

describe('BugHunterPipelineController', () => {
  let app: INestApplication;
  let mockBugHunterService: Partial<BugHunterService>;
  let mockBugFindingService: Partial<BugFindingService>;

  beforeEach(async () => {
    mockBugHunterService = {
      recordResolvedModel: jest.fn().mockResolvedValue(undefined),
    };

    mockBugFindingService = {
      persistFindings: jest.fn().mockResolvedValue([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BugHunterPipelineController],
      providers: [
        { provide: BugHunterService, useValue: mockBugHunterService },
        { provide: BugFindingService, useValue: mockBugFindingService },
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        // The real pipeline runs with .0, not these. The important bit is that
        // *any* pipe is present, and Nest's default sets these.
        // https://docs.nestjs.com/techniques/validation#passing-validation-options
        disableErrorMessages: false,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should successfully record the engine and model for a bug hunt run via the pipeline endpoint', async () => {
    const runId = uuidv4();
    const engine = 'test-bug-hunter-engine';
    const model = 'test-bug-hunter-model';

    const dto: RecordBugHuntRunModelDto = { engine, model };

    await request(app.getHttpServer())
      .post(`/v1/bug-hunter/pipeline/runs/${runId}/model`)
      .set('x-api-key', 'test-api-key') // Assuming API key is required for authentication
      .send(dto)
      .expect(201) // Expect HTTP 201 Created for successful POST
      .expect({ engine, model });

    expect(mockBugHunterService.recordResolvedModel).toHaveBeenCalledWith(
      runId,
      dto,
    );
  });

  it('should return BadRequestException when evidence field contains malformed JSON string', async () => {
    const runId = uuidv4();
    const repo = 'ally-be';
    // Valid outer JSON, but malformed JSON string within the 'evidence' field
    const malformedEvidenceString =
      '{ "key": "value with unescaped \" quote" }';

    const persistBugFindingsDto: PersistBugFindingsDto = {
      repo,
      findings: [
        {
          source: BugFindingSource.PRODUCTION_LOG,
          description: 'Test bug description',
          evidence: malformedEvidenceString,
        },
      ],
    };

    await request(app.getHttpServer())
      .post(`/v1/bug-hunter/runs/${runId}/findings`)
      .set('x-api-key', 'test-api-key')
      .send(persistBugFindingsDto)
      .expect(400) // Expect HTTP 400 Bad Request
      .expect((res) => {
        expect(res.body.message).toEqual([
          'findings.0.Text ({ "key": "value with unescaped " quote" }) is not a valid JSON string.',
        ]);
      });

    expect(mockBugFindingService.persistFindings).not.toHaveBeenCalled();
  });
});
