import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BugHunterMissClassifierService } from '../bug-hunter-miss-classifier.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugHuntEvent } from '../../entity/bug-hunt-event.entity';
import {
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { toBugFindingMiss } from '../../type/bug-finding-miss.type';

const textResponse = (json: unknown) => ({ text: JSON.stringify(json) });

const reported = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-report',
    repo: 'ally-web',
    source: BugFindingSource.REPORTED_BUG,
    status: BugFindingStatus.NEW,
    title: 'English text with Marathi selected',
    description: 'With Marathi selected the Settings buttons stay in English.',
    createdAt: new Date('2026-10-01T10:00:00Z'),
    metadata: { rediscoveredCount: 2 },
    ...overrides,
  }) as BugFinding;

const own = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-ux-1',
    repo: 'ally-web',
    source: BugFindingSource.UX_SIGNAL,
    status: BugFindingStatus.DISMISSED,
    title: 'Dead clicks on /character-library',
    decisionReason: 'not_a_bug',
    createdAt: new Date('2026-09-28T06:00:00Z'),
    ...overrides,
  }) as BugFinding;

describe('BugHunterMissClassifierService', () => {
  let service: BugHunterMissClassifierService;
  let mockComplete: jest.Mock;
  let findingRepo: { findOne: jest.Mock; find: jest.Mock; update: jest.Mock };
  let eventRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    mockComplete = jest.fn();
    findingRepo = {
      findOne: jest.fn().mockResolvedValue(reported()),
      find: jest.fn().mockResolvedValue([own()]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    eventRepo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterMissClassifierService,
        {
          provide: PromptSharedService,
          useValue: {
            getPromptByCode: jest
              .fn()
              .mockResolvedValue('You are Bug Hunter...'),
          },
        },
        { provide: LlmCompletionService, useValue: { complete: mockComplete } },
        { provide: getRepositoryToken(BugFinding), useValue: findingRepo },
        { provide: getRepositoryToken(BugHuntEvent), useValue: eventRepo },
      ],
    }).compile();

    service = module.get(BugHunterMissClassifierService);
  });

  it('stores a validated miss under metadata.miss and writes a timeline event', async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        reason: 'no_sense',
        sense: 'user_journey',
        confidence: 0.9,
        rationale: 'Only visible on the rendered screen.',
      }),
    );

    const miss = await service.classifyAndRecord('f-report');

    expect(miss?.reason).toBe('no_sense');
    expect(miss?.sense).toBe('user_journey');
    expect(findingRepo.update).toHaveBeenCalledWith(
      'f-report',
      expect.objectContaining({
        metadata: expect.objectContaining({
          rediscoveredCount: 2,
          miss: expect.objectContaining({ reason: 'no_sense' }),
        }),
      }),
    );
    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: null,
        findingId: 'f-report',
        stage: BugHuntEventStage.FINDER_RESULT,
        payload: expect.objectContaining({ trigger: 'intake' }),
      }),
    );
    const { model, task } = mockComplete.mock.calls[0][0];
    expect(model).toMatch(/^gemini-/);
    expect(task).toBe('bug_hunter');
  });

  it('shows the model its own recent findings on the repo and keeps a matched id only from that list', async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        reason: 'detected_declined',
        sense: 'ux_signal',
        matchedFindingId: 'f-ux-1',
        confidence: 0.8,
        rationale:
          'The 28 Sept dead-click signal on the same route was dismissed.',
      }),
    );

    const miss = await service.classifyAndRecord('f-report');

    expect(findingRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ repo: 'ally-web' }),
      }),
    );
    expect(mockComplete.mock.calls[0][0].prompt).toContain('id=f-ux-1');
    expect(miss?.matchedFindingId).toBe('f-ux-1');
  });

  it('drops a matched finding id the model was never shown', async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        reason: 'detected_not_fixed',
        sense: 'browser_errors',
        matchedFindingId: 'f-invented',
        rationale: 'guess',
      }),
    );

    const miss = await service.classifyAndRecord('f-report');

    expect(miss?.reason).toBe('detected_not_fixed');
    expect(miss?.matchedFindingId).toBeNull();
  });

  it('discards an answer whose reason and sense contradict each other', async () => {
    mockComplete.mockResolvedValue(
      textResponse({ reason: 'no_sense', sense: 'code_review' }),
    );

    const miss = await service.classifyAndRecord('f-report');

    expect(miss).toBeNull();
    expect(findingRepo.update).not.toHaveBeenCalled();
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('does nothing for a finding that is not a human report', async () => {
    findingRepo.findOne.mockResolvedValue(
      reported({ source: BugFindingSource.CODE_REVIEW }),
    );

    const miss = await service.classifyAndRecord('f-report');

    expect(miss).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('swallows a model failure into a warning rather than throwing', async () => {
    mockComplete.mockRejectedValue(new Error('quota'));

    await expect(service.classifyAndRecord('f-report')).resolves.toBeNull();
    expect(findingRepo.update).not.toHaveBeenCalled();
  });
});

describe('toBugFindingMiss', () => {
  it('forces sense to null for not_a_miss', () => {
    const miss = toBugFindingMiss(
      { reason: 'not_a_miss', sense: 'user_journey' },
      'gemini-2.5-flash',
    );
    expect(miss?.sense).toBeNull();
  });

  it('rejects a sense_missed answer that names a sense Bug Hunter does not have', () => {
    expect(
      toBugFindingMiss(
        { reason: 'sense_missed', sense: 'voice_qa' },
        'gemini-2.5-flash',
      ),
    ).toBeNull();
  });

  it('rejects an unknown reason', () => {
    expect(
      toBugFindingMiss(
        { reason: 'bad_luck', sense: 'tests' },
        'gemini-2.5-flash',
      ),
    ).toBeNull();
  });
});
