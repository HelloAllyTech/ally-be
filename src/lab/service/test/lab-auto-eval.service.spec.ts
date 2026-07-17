import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LabAutoEvalService } from '../lab-auto-eval.service';
import { LabAutoEvaluationRepository } from '../../repository/lab-auto-evaluation.repository';
import { LabRunService } from '../lab-run.service';
import { LabRunStatus } from '../../entity/lab-run.entity';

describe('LabAutoEvalService', () => {
  let service: LabAutoEvalService;
  let autoEvalRepository: {
    create: jest.Mock;
    save: jest.Mock;
    listForRun: jest.Mock;
  };
  let runService: {
    getById: jest.Mock;
    callModel: jest.Mock;
    getDefaultModel: jest.Mock;
  };

  const completedRun = {
    id: 'run1',
    status: LabRunStatus.COMPLETED,
    resolvedPrompt: 'Say hi',
    output: 'Hello there!',
  };

  beforeEach(async () => {
    autoEvalRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => entity),
      listForRun: jest.fn(),
    };
    runService = {
      getById: jest.fn(),
      callModel: jest.fn(),
      getDefaultModel: jest.fn().mockReturnValue('claude-default'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabAutoEvalService,
        { provide: LabAutoEvaluationRepository, useValue: autoEvalRepository },
        { provide: LabRunService, useValue: runService },
      ],
    }).compile();

    service = module.get<LabAutoEvalService>(LabAutoEvalService);
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects runs that are not completed', async () => {
    runService.getById.mockResolvedValue({
      ...completedRun,
      status: LabRunStatus.FAILED,
      output: null,
    });
    await expect(
      service.evaluate('run1', { criteria: 'be nice' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parses the judge score/reasoning from JSON (tolerating surrounding prose)', async () => {
    runService.getById.mockResolvedValue(completedRun);
    runService.callModel.mockResolvedValue({
      text: 'Here is my verdict: {"score": 87, "reasoning": "Clear and correct."} done',
      usage: null,
    });

    const record = await service.evaluate('run1', {
      criteria: 'accuracy',
      model: 'claude-x',
    });

    expect(record.model).toBe('claude-x');
    expect(record.score).toBe(87);
    expect(record.reasoning).toBe('Clear and correct.');
    expect(record.error).toBeUndefined();
  });

  it('clamps an out-of-range score into 0–100', async () => {
    runService.getById.mockResolvedValue(completedRun);
    runService.callModel.mockResolvedValue({
      text: '{"score": 250, "reasoning": "x"}',
      usage: null,
    });
    const record = await service.evaluate('run1', { criteria: 'c' });
    expect(record.score).toBe(100);
  });

  it('records an error (null score) when the judge output is unparseable', async () => {
    runService.getById.mockResolvedValue(completedRun);
    runService.callModel.mockResolvedValue({
      text: 'no json here',
      usage: null,
    });
    const record = await service.evaluate('run1', { criteria: 'c' });
    expect(record.score).toBeNull();
    expect(record.error).toMatch(/parse/i);
  });

  it('defaults to the AI Lab judge model when none is given', async () => {
    runService.getById.mockResolvedValue(completedRun);
    runService.callModel.mockResolvedValue({
      text: '{"score": 50, "reasoning": "ok"}',
      usage: null,
    });
    await service.evaluate('run1', { criteria: 'c' });
    expect(runService.callModel).toHaveBeenCalledWith(
      'claude-default',
      expect.stringContaining('CRITERIA'),
      { temperature: 0 },
    );
  });
});
