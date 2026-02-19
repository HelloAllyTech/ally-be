import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScenarioReportTranscriptService } from './scenario-report-transcript.service';
import { ScenarioReportTranscript } from '../entity/scenario-report-transcript.entity';
import { Repository } from 'typeorm';

describe('ScenarioReportTranscriptService', () => {
  let service: ScenarioReportTranscriptService;
  let repository: jest.Mocked<Repository<ScenarioReportTranscript>>;

  const reportId = 'report-uuid-1';
  const mockTranscripts = [
    {
      content: 'Hello',
      start_time: 0,
      role: 'user',
    },
    {
      content: 'Hi there',
      start_time: 1.5,
      role: 'ai-client',
    },
  ];

  beforeEach(async () => {
    const mockRepo = {
      create: jest.fn((entity: any) => entity),
      save: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioReportTranscriptService,
        {
          provide: getRepositoryToken(ScenarioReportTranscript),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<ScenarioReportTranscriptService>(
      ScenarioReportTranscriptService,
    );
    repository = module.get(getRepositoryToken(ScenarioReportTranscript));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addTranscripts', () => {
    it('should do nothing when transcripts array is empty', async () => {
      await service.addTranscripts(reportId, []);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should create and save transcript entities with reportId and transcript fields', async () => {
      await service.addTranscripts(reportId, mockTranscripts);

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(repository.create).toHaveBeenNthCalledWith(1, {
        scenarioReportId: reportId,
        content: 'Hello',
        startSeconds: 0,
        role: 'user',
      });
      expect(repository.create).toHaveBeenNthCalledWith(2, {
        scenarioReportId: reportId,
        content: 'Hi there',
        startSeconds: 1.5,
        role: 'ai-client',
      });
      expect(repository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('getScenarioReportTranscripts', () => {
    it('should return messages and count from findAndCount by scenarioReportId', async () => {
      const messages = [
        {
          id: 't1',
          scenarioReportId: reportId,
          content: 'Hello',
          role: 'user',
          startSeconds: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      repository.findAndCount.mockResolvedValue([messages, 1]);

      const result = await service.getScenarioReportTranscripts(reportId);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: { scenarioReportId: reportId },
      });
      expect(result).toEqual({ messages, count: 1 });
    });

    it('should return empty messages and zero count when no transcripts', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getScenarioReportTranscripts(reportId);

      expect(result).toEqual({ messages: [], count: 0 });
    });
  });
});
