import { Test, TestingModule } from '@nestjs/testing';

import { BugHunterRepoClassifierService } from '../bug-hunter-repo-classifier.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

const textResponse = (json: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(json) }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe('BugHunterRepoClassifierService', () => {
  let service: BugHunterRepoClassifierService;
  let promptSharedService: { getPromptByCode: jest.Mock };
  let llmUsage: { record: jest.Mock };

  beforeEach(async () => {
    mockMessagesCreate.mockReset();
    promptSharedService = {
      getPromptByCode: jest.fn().mockResolvedValue('You are Bug Hunter...'),
    };
    llmUsage = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterRepoClassifierService,
        {
          provide: AppConfigService,
          useValue: {
            anthropic: { apiKey: 'test-key', autofillModel: 'claude-test' },
          },
        },
        { provide: PromptSharedService, useValue: promptSharedService },
        { provide: LlmUsageService, useValue: llmUsage },
      ],
    }).compile();

    service = module.get(BugHunterRepoClassifierService);
  });

  it('returns a dispatchable repo the model names', async () => {
    mockMessagesCreate.mockResolvedValue(
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
    expect(llmUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'bug_hunter' }),
    );
  });

  it('discards a repo the model invents that is not a live dispatch target', async () => {
    mockMessagesCreate.mockResolvedValue(
      textResponse({ repo: 'some-other-repo', rationale: 'guess' }),
    );

    const result = await service.classifyRepo('Something vague.');

    expect(result.repo).toBeNull();
  });

  it('recognizes ally-mobile as a dispatchable repo, like any other', async () => {
    mockMessagesCreate.mockResolvedValue(
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
    mockMessagesCreate.mockRejectedValue(new Error('rate limited'));

    const result = await service.classifyRepo('Anything.');

    expect(result).toEqual({
      repo: null,
      rationale: '',
    });
  });

  it('degrades to unclassified on unparseable model output', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await service.classifyRepo('Anything.');

    expect(result.repo).toBeNull();
  });
});
