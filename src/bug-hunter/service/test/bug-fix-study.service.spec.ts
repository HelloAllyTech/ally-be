import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFixStudyService } from '../bug-fix-study.service';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    title: 'Tooltips stay in English after switching to Marathi',
    description:
      'With Marathi selected, the Comments and Add custom field tooltips stay in English.',
    file: 'apps/ally-helpline-dashboard/src/components/app-tooltip/AppTooltip.tsx',
    metadata: { confidence: 0.8 },
    ...over,
  }) as BugFinding;

const study = {
  feature: 'CMS tooltips on helpline screens',
  howItWorksToday: [
    'tooltips table, edited under Manage Tooltips',
    'GET /v1/tooltips/active translates by language (tooltip.service.ts)',
    'AppTooltip.tsx fetches with no language',
  ],
  valueLivesIn: 'database',
  rootCause: 'The app never sends its language.',
  approach: 'Send i18n.language as languageCode; accept it server-side.',
  filesToChange: ['AppTooltip.tsx'],
  testPlan: 'AppTooltip.test.tsx asserts the hook is called with the language',
};

describe('BugFixStudyService', () => {
  let service: BugFixStudyService;
  let complete: jest.Mock;
  let getPromptByCode: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    complete = jest.fn();
    getPromptByCode = jest.fn().mockResolvedValue('review prompt');
    update = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        BugFixStudyService,
        { provide: PromptSharedService, useValue: { getPromptByCode } },
        { provide: LlmCompletionService, useValue: { complete } },
        { provide: getRepositoryToken(BugFinding), useValue: { update } },
      ],
    }).compile();
    service = module.get(BugFixStudyService);
  });

  it('refuses a study missing required fields, naming them, and stores nothing', async () => {
    await expect(
      service.record(finding(), 'run-1', { feature: 'x' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.record(finding(), 'run-1', { feature: 'x' }),
    ).rejects.toThrow(/howItWorksToday.*valueLivesIn.*rootCause/);
    expect(update).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("stores the study with the reviewer's concerns and keeps the rest of the metadata", async () => {
    complete.mockResolvedValue({
      text: '{"concerns":["The study names no client that sends the language code."]}',
    });
    const stored = await service.record(finding(), 'run-1', study);
    expect(stored.review).toEqual({
      concerns: ['The study names no client that sends the language code.'],
      model: 'gemini-2.5-flash',
      at: expect.any(String),
    });
    expect(stored.runId).toBe('run-1');
    expect(update).toHaveBeenCalledWith('f-1', {
      metadata: { confidence: 0.8, study: stored },
    });
    // The reviewer sees the bug and the study, framed as the session's claims.
    const call = complete.mock.calls[0][0];
    expect(call.taskId).toBe('bug-hunter-study-reviewer');
    expect(call.jsonMode).toBe(true);
    expect(call.prompt).toContain('Tooltips stay in English');
    expect(call.prompt).toContain('The value lives in: a database table');
  });

  it('proceeds with an empty review when the model is down or answers junk, never blocking the session', async () => {
    complete.mockRejectedValueOnce(new Error('503'));
    const down = await service.record(finding(), 'run-1', study);
    expect(down.review?.concerns).toEqual([]);

    complete.mockResolvedValueOnce({ text: 'not json' });
    const junk = await service.record(finding(), 'run-1', study);
    expect(junk.review?.concerns).toEqual([]);

    complete.mockResolvedValueOnce({
      text: '```json\n{"concerns":["a","b","c","d","e","f"]}\n```',
    });
    const many = await service.record(finding(), 'run-1', study);
    expect(many.review?.concerns).toHaveLength(4);
  });

  it('records a study without a reviewer when the prompt is missing', async () => {
    getPromptByCode.mockResolvedValue(null);
    const stored = await service.record(finding(), null, study);
    expect(stored.review).toEqual({
      concerns: [],
      model: null,
      at: expect.any(String),
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
