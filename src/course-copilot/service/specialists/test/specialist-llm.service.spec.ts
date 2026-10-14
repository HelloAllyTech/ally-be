import { Test } from '@nestjs/testing';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  buildSpecialistPrompt,
  parseSpecialistJson,
  SpecialistLlmService,
} from '../specialist-llm.service';
import { SpecialistValidationError } from '../specialist.types';
import { fakeLlm } from './specialist-test.fixtures';

const baseRequest = {
  promptCode: 'course_copilot_quiz_writer',
  taskId: 'course-copilot-quiz',
  task: LlmTask.COURSE_COPILOT_QUIZ,
  maxTokens: 1000,
  usageMetadata: { courseCopilotSessionId: 's-1', jobId: 'j-1' },
  specialist: 'quiz',
};

describe('SpecialistLlmService', () => {
  it('resolves through Nest DI with its two dependencies', async () => {
    const module = await Test.createTestingModule({
      providers: [
        SpecialistLlmService,
        {
          provide: PromptSharedService,
          useValue: { getPromptByCode: jest.fn() },
        },
        { provide: LlmCompletionService, useValue: { complete: jest.fn() } },
      ],
    }).compile();
    expect(module.get(SpecialistLlmService)).toBeInstanceOf(
      SpecialistLlmService,
    );
  });

  it('renders the prompt, asks for JSON and tags usage with the specialist', async () => {
    const llm = fakeLlm(
      [{ ok: true }],
      'Count={{question_count}} Brief={{brief_json}}',
    );
    const result = await llm.service.runJson({
      ...baseRequest,
      variables: {
        question_count: '6',
        brief_json: { audience: 'volunteers' },
      },
    });

    expect(result).toEqual({
      data: { ok: true },
      model: 'fake-model',
      provider: 'fake',
    });
    expect(llm.getPromptByCode).toHaveBeenCalledWith(
      'course_copilot_quiz_writer',
    );
    const call = llm.complete.mock.calls[0][0];
    expect(call).toMatchObject({
      taskId: 'course-copilot-quiz',
      task: LlmTask.COURSE_COPILOT_QUIZ,
      jsonMode: true,
      promptCode: 'course_copilot_quiz_writer',
      maxTokens: 1000,
      usageMetadata: {
        courseCopilotSessionId: 's-1',
        jobId: 'j-1',
        specialist: 'quiz',
      },
    });
    expect(call.prompt).toContain('Count=6');
    // Objects are JSON-stringified, because renderTemplate substitutes text.
    expect(call.prompt).toContain('"audience": "volunteers"');
  });

  it('appends the repair block with every error', async () => {
    const llm = fakeLlm([{ ok: true }]);
    await llm.service.runJson({
      ...baseRequest,
      variables: {},
      repairErrors: [
        'Question 2 has no prompt.',
        'Question 4 needs an explanation.',
      ],
    });
    const prompt = llm.promptOf(0);
    expect(prompt).toContain(
      'Your previous output was rejected for these reasons:',
    );
    expect(prompt).toContain('- Question 2 has no prompt.');
    expect(prompt).toContain('- Question 4 needs an explanation.');
    expect(
      prompt.trim().endsWith('Produce the whole object again, fixed.'),
    ).toBe(true);
    expect(llm.complete.mock.calls[0][0].usageMetadata.repairPass).toBe(true);
  });

  it('appends a revision block and keeps double-brace tokens in prior content', () => {
    const prompt = buildSpecialistPrompt('Write {{thing}}.', {
      variables: { thing: 'a quiz' },
      previous: {
        content: { questions: [{ template: 'You {{b1}} the feeling.' }] },
        instructions: 'Make question 1 harder.',
      },
    });
    expect(prompt).toContain('Write a quiz.');
    expect(prompt).toContain('REVISION');
    expect(prompt).toContain(
      'The trainer asked for this change: Make question 1 harder.',
    );
    // Appended after rendering, so renderTemplate never blanks it.
    expect(prompt).toContain('You {{b1}} the feeling.');
  });

  it('puts the repair block after the revision block', () => {
    const prompt = buildSpecialistPrompt('X', {
      variables: {},
      previous: { content: {}, instructions: 'Shorter.' },
      repairErrors: ['Too long.'],
    });
    expect(prompt.indexOf('REVISION')).toBeLessThan(
      prompt.indexOf('Too long.'),
    );
  });

  it('throws a clear error when the prompt row is missing', async () => {
    const llm = fakeLlm([{ ok: true }], null);
    await expect(
      llm.service.runJson({ ...baseRequest, variables: {} }),
    ).rejects.toThrow(/course_copilot_quiz_writer.*was not found/);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('turns unparseable output into a SpecialistValidationError', async () => {
    const llm = fakeLlm(['I could not do that, sorry.']);
    const error = await llm.service
      .runJson({ ...baseRequest, variables: {} })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors).toEqual(['The model did not return JSON']);
  });
});

describe('parseSpecialistJson', () => {
  it('reads a fenced block', () => {
    expect(parseSpecialistJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('reads the outermost object out of surrounding prose', () => {
    expect(
      parseSpecialistJson('Here it is: {"a": {"b": [1, 2]}} — hope that helps'),
    ).toEqual({ a: { b: [1, 2] } });
  });

  it('rejects arrays, truncated JSON and empty text', () => {
    for (const text of ['[1, 2]', '{"a": [1, 2', '', '   ']) {
      expect(() => parseSpecialistJson(text)).toThrow(
        SpecialistValidationError,
      );
    }
  });
});
