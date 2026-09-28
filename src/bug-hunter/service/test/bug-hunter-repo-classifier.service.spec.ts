import { Test, TestingModule } from '@nestjs/testing';

import { BugHunterRepoClassifierService } from '../bug-hunter-repo-classifier.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';

const textResponse = (json: unknown) => ({ text: JSON.stringify(json) });

describe('BugHunterRepoClassifierService', () => {
  let service: BugHunterRepoClassifierService;
  let promptSharedService: { getPromptByCode: jest.Mock };
  let mockComplete: jest.Mock;

  beforeEach(async () => {
    mockComplete = jest.fn();
    promptSharedService = {
      getPromptByCode: jest.fn().mockResolvedValue('You are Bug Hunter...'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterRepoClassifierService,
        { provide: PromptSharedService, useValue: promptSharedService },
        {
          provide: LlmCompletionService,
          useValue: { complete: mockComplete },
        },
      ],
    }).compile();

    service = module.get(BugHunterRepoClassifierService);
  });

  it('returns a dispatchable repo the model names', async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        repo: 'ally-web',
        confidence: 0.9,
        rationale: 'Terms modal is a browser screen.',
      }),
    );

    const result = await service.classifyRepo(
      'The terms modal link is unstyled.',
    );

    expect(result.repo).toBe('ally-web');
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'bug_hunter' }),
    );
  });

  it('names a Gemini model, never a Claude one', async () => {
    mockComplete.mockResolvedValue(textResponse({ repo: 'ally-be' }));

    await service.classifyRepo('Anything.');

    const { model } = mockComplete.mock.calls[0][0];
    expect(model).toMatch(/^gemini-/);
  });

  it('discards a repo the model invents that is not a live dispatch target', async () => {
    mockComplete.mockResolvedValue(
      textResponse({ repo: 'some-other-repo', rationale: 'guess' }),
    );

    const result = await service.classifyRepo('Something vague.');

    expect(result.repo).toBeNull();
  });

  it('recognizes ally-mobile as a dispatchable repo, like any other', async () => {
    mockComplete.mockResolvedValue(
      textResponse({
        repo: 'ally-mobile',
        rationale: 'Native app screen.',
      }),
    );

    const result = await service.classifyRepo(
      'The native app crashes on login.',
    );

    expect(result.repo).toBe('ally-mobile');
  });

  it('degrades to unclassified rather than throwing when the model call fails', async () => {
    mockComplete.mockRejectedValue(new Error('rate limited'));

    const result = await service.classifyRepo('Anything.');

    expect(result).toEqual({
      repo: null,
      rationale: '',
    });
  });

  it('degrades to unclassified on unparseable model output', async () => {
    mockComplete.mockResolvedValue({ text: 'not json at all' });

    const result = await service.classifyRepo('Anything.');

    expect(result.repo).toBeNull();
  });
});
