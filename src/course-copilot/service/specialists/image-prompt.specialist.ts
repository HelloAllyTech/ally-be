import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ImagePromptInput,
  SpecialistValidationError,
} from './specialist.types';
import {
  asText,
  isRecord,
  SPECIALIST_MAX_TOKENS,
  truncateAtWord,
} from './specialist.util';

const IMAGE_PROMPT_MAX_CHARS = 1_200;
const CONTEXT_MAX_CHARS = 2_000;

/**
 * Appended in code to every image prompt, whatever the model wrote. These are
 * the constraints that must hold even if the prompt row is edited in the
 * dashboard: an image with lettering in it, or a recognisable face, is not
 * something a trainer can fix after the fact.
 */
export const IMAGE_PROMPT_GUARDRAILS =
  'Realistic documentary photograph. No text, letters, numbers, captions, ' +
  'signs, logos or watermarks anywhere in the image. No identifiable real ' +
  'person. Nothing graphic or distressing. 16:9 landscape aspect ratio.';

/**
 * Writes the prompt for a course cover or an article illustration, in the
 * house style of `cover_image_generation.txt`: documentary, natural, no
 * glamour, no text, 16:9.
 *
 * Returns the finished prompt string; the media service hands it to the image
 * provider unchanged.
 */
@Injectable()
export class ImagePromptSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async write(input: ImagePromptInput): Promise<string> {
    const audience = input.brief?.audience ?? {};
    const { data } = await this.llm.runJson({
      specialist: 'image_prompt',
      promptCode: COURSE_COPILOT_PROMPTS.IMAGE_PROMPT,
      taskId: COURSE_COPILOT_AI_TASKS.IMAGE_PROMPT,
      task: LlmTask.COURSE_COPILOT_IMAGE_PROMPT,
      maxTokens: SPECIALIST_MAX_TOKENS.IMAGE_PROMPT,
      usageMetadata: input.usageMetadata,
      // Snake-case names on purpose: `renderTemplate` also rewrites `<name>`
      // tags that match a variable, and `<title>` can occur in context text.
      variables: {
        image_purpose:
          input.purpose === 'cover'
            ? 'the cover image for the whole course, shown on the course card and at the top of the course'
            : 'an illustration placed inside one article of the course',
        image_title: input.title,
        image_context: truncateAtWord(input.context ?? '', CONTEXT_MAX_CHARS),
        audience_json: JSON.stringify(audience, null, 2),
        course_tone: input.brief?.shape?.tone || 'warm, calm and respectful',
      },
    });
    return normaliseImagePrompt(data);
  }
}

/** Pure: raw model JSON → final prompt with the guardrails appended. */
export function normaliseImagePrompt(raw: Record<string, any>): string {
  const body = truncateAtWord(
    asText(isRecord(raw) ? (raw.prompt ?? raw.imagePrompt) : '')
      .replace(/\s+/g, ' ')
      .trim(),
    IMAGE_PROMPT_MAX_CHARS,
  );
  if (!body) {
    throw new SpecialistValidationError(['The image prompt was empty.']);
  }
  return `${body.replace(/[.\s]*$/, '.')} ${IMAGE_PROMPT_GUARDRAILS}`;
}
