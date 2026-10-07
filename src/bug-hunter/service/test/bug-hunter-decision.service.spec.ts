import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BugHunterDecisionService } from '../bug-hunter-decision.service';
import { BugHuntDecision } from '../../entity/bug-hunt-decision.entity';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';

const textResponse = (json: unknown) => ({ text: JSON.stringify(json) });

describe('BugHunterDecisionService', () => {
  let service: BugHunterDecisionService;
  let mockComplete: jest.Mock;
  let saved: Record<string, unknown>[];

  const senses = ['tests', 'code_review', 'production_log'] as const;
  const request = (modelOwned: boolean) => ({
    point: 'D1' as const,
    question: 'senses',
    repo: 'ally-web',
    runId: 'run-1',
    menu: [...senses],
    context: { trigger: 'merge', long: 'x'.repeat(1000) },
    modelOwned,
    rule: () => ['code_review', 'tests'] as string[],
    validate: (raw: unknown) =>
      Array.isArray(raw) &&
      raw.every((s) => senses.includes(s as never)) &&
      raw.length
        ? (raw as string[])
        : null,
  });

  beforeEach(async () => {
    mockComplete = jest.fn();
    saved = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterDecisionService,
        {
          provide: getRepositoryToken(BugHuntDecision),
          useValue: {
            create: jest.fn().mockImplementation((v) => v),
            save: jest.fn().mockImplementation((v) => {
              saved.push(v);
              return Promise.resolve({ id: `dec-${saved.length}`, ...v });
            }),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PromptSharedService,
          useValue: {
            getPromptByCode: jest.fn().mockResolvedValue('You decide…'),
          },
        },
        { provide: LlmCompletionService, useValue: { complete: mockComplete } },
      ],
    }).compile();
    service = module.get(BugHunterDecisionService);
  });

  it("acts on the model's pick when it owns the point, and keeps the rule as the shadow", async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        pick: ['code_review'],
        confidence: 0.7,
        reason: 'only the diff changed',
      }),
    );

    const result = await service.decide(request(true));

    expect(result).toMatchObject({
      pick: ['code_review'],
      owner: 'model',
      shadowPick: ['code_review', 'tests'],
      reason: 'only the diff changed',
      confidence: 0.7,
    });
    expect(saved[0]).toMatchObject({
      point: 'D1',
      owner: 'model',
      shadowOwner: 'rule',
      model: expect.stringMatching(/^gemini-/),
      inputs: expect.objectContaining({ modelConfidence: 0.7 }),
    });
    // long inputs are clipped before storage
    expect((saved[0].inputs as { long: string }).long.length).toBeLessThan(410);
  });

  it('lets the rule act when the model picks off the menu, and says so', async () => {
    mockComplete.mockResolvedValue(
      textResponse({ pick: ['vibes'], reason: 'hmm' }),
    );

    const result = await service.decide(request(true));

    expect(result.owner).toBe('rule');
    expect(result.pick).toEqual(['code_review', 'tests']);
    expect(result.shadowPick).toBeNull();
    expect(result.reason).toMatch(/picked off the menu/);
  });

  it('lets the rule act when the model fails, without throwing', async () => {
    mockComplete.mockRejectedValue(new Error('quota'));

    const result = await service.decide(request(true));

    expect(result.owner).toBe('rule');
    expect(result.reason).toMatch(/did not answer/);
    expect(saved[0]).toMatchObject({ owner: 'rule', model: null });
  });

  it('on a rule-owned point acts on the rule and records the model as the shadow', async () => {
    mockComplete.mockResolvedValue(
      textResponse({ pick: ['tests'], reason: 'r' }),
    );

    const result = await service.decide(request(false));

    expect(result).toMatchObject({
      pick: ['code_review', 'tests'],
      owner: 'rule',
      shadowPick: ['tests'],
    });
    expect(saved[0]).toMatchObject({ owner: 'rule', shadowOwner: 'model' });
  });
});
