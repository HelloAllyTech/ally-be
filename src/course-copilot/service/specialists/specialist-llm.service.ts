import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SpecialistValidationError } from './specialist.types';

export interface SpecialistJsonRequest {
  /** `COURSE_COPILOT_PROMPTS.*` — also the prompt row whose model overrides the task row. */
  promptCode: string;
  /** `COURSE_COPILOT_AI_TASKS.*` — the AI-task-registry row. */
  taskId: string;
  task: LlmTask;
  /**
   * `{{name}}` values. Strings go in as they are; anything else is
   * JSON-stringified, because `renderTemplate` substitutes text only.
   */
  variables: Record<string, unknown>;
  maxTokens: number;
  /** From the context/input: `{ courseCopilotSessionId, jobId? }`. */
  usageMetadata: Record<string, any>;
  /** Which specialist is calling — recorded on the usage row. */
  specialist: string;
  /** Validator errors from the previous attempt (the one repair pass). */
  repairErrors?: string[];
  /** Regeneration: the item's current content and the trainer's change. */
  previous?: { content: Record<string, any>; instructions: string };
}

export interface SpecialistJsonResult<T> {
  data: T;
  model: string;
  provider: string;
}

/**
 * The one model call every content specialist makes: load its prompt, render
 * it, ask for JSON, parse what comes back.
 *
 * Kept in one place so the repair and revision blocks read the same for every
 * specialist, and so "the model wrapped its JSON in a code fence" is handled
 * once rather than four times.
 */
@Injectable()
export class SpecialistLlmService {
  constructor(
    private readonly promptShared: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  async runJson<T = Record<string, any>>(
    request: SpecialistJsonRequest,
  ): Promise<SpecialistJsonResult<T>> {
    const template = await this.promptShared.getPromptByCode(
      request.promptCode,
    );
    if (!template) {
      // Unlike the interviewer, a specialist has no useful fallback prompt:
      // writing a quiz from a hardcoded paragraph would produce something that
      // passes validation and is quietly worse. Fail the job loudly instead.
      throw new Error(
        `Course Copilot prompt "${request.promptCode}" was not found. ` +
          `It ships as src/prompts/course_copilot/*.txt and syncs to Prompt ` +
          `Management on startup — check the sync ran.`,
      );
    }

    const prompt = buildSpecialistPrompt(template, request);
    const result = await this.llmCompletion.complete({
      taskId: request.taskId,
      task: request.task,
      prompt,
      maxTokens: request.maxTokens,
      jsonMode: true,
      promptCode: request.promptCode,
      usageMetadata: {
        ...(request.usageMetadata ?? {}),
        specialist: request.specialist,
        ...(request.repairErrors?.length ? { repairPass: true } : {}),
        ...(request.previous ? { regenerate: true } : {}),
      },
    });

    return {
      data: parseSpecialistJson(result.text) as T,
      model: result.model,
      provider: result.provider,
    };
  }
}

/**
 * Render the template, then append the revision and repair blocks. Both go
 * after rendering so nothing in them — prior content can contain `{{blankId}}`
 * tokens — is mistaken for a template variable.
 */
export function buildSpecialistPrompt(
  template: string,
  request: Pick<
    SpecialistJsonRequest,
    'variables' | 'repairErrors' | 'previous'
  >,
): string {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.variables ?? {})) {
    variables[key] =
      typeof value === 'string'
        ? value
        : value === undefined || value === null
          ? ''
          : JSON.stringify(value, null, 2);
  }

  let prompt = renderTemplate(template, variables);

  if (request.previous) {
    const instructions =
      request.previous.instructions?.trim() ||
      'Improve it in keeping with the brief.';
    prompt +=
      '\n\n---\nREVISION\n' +
      'This item already exists. Its current content, as JSON:\n' +
      `${JSON.stringify(request.previous.content ?? {}, null, 2)}\n\n` +
      `The trainer asked for this change: ${instructions}\n\n` +
      'Apply that change. Keep everything the trainer did not ask about — ' +
      'wording, order, ids and answer keys — unless the change requires ' +
      'otherwise. Return the whole object in the output format above, with ' +
      'the change applied.';
  }

  if (request.repairErrors?.length) {
    prompt +=
      '\n\n---\nYour previous output was rejected for these reasons:\n' +
      request.repairErrors.map((error) => `- ${error}`).join('\n') +
      '\nProduce the whole object again, fixed.';
  }

  return prompt;
}

/**
 * Parse a model's JSON answer leniently: strip a code fence if there is one,
 * try the text as it is, then the outermost `{ … }`. Only a JSON object
 * counts — every specialist's output format is one.
 */
export function parseSpecialistJson(text: string): Record<string, any> {
  const raw = (text ?? '').trim();
  const fenced = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced ? fenced[1] : raw).trim();

  const candidates = [body];
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(body.slice(start, end + 1));
  if (fenced) {
    const outerStart = raw.indexOf('{');
    const outerEnd = raw.lastIndexOf('}');
    if (outerStart !== -1 && outerEnd > outerStart) {
      candidates.push(raw.slice(outerStart, outerEnd + 1));
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new SpecialistValidationError(['The model did not return JSON']);
}
