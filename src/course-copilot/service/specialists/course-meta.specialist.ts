import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  CourseMetaInput,
  CourseMetaOutput,
  SpecialistValidationError,
} from './specialist.types';
import {
  asText,
  briefForPrompt,
  courseOutlineForPrompt,
  htmlToText,
  isRecord,
  SPECIALIST_MAX_TOKENS,
  truncateAtWord,
} from './specialist.util';

export const COURSE_TITLE_MAX_CHARS = 80;
/** Two short paragraphs; anything past this is a third paragraph in disguise. */
const COURSE_DESCRIPTION_MAX_CHARS = 900;

/**
 * Polishes the course's title and description once the blueprint is fixed.
 *
 * The description is plain text — two short paragraphs separated by a blank
 * line — because `TrackService.sanitizeDescription` turns newlines in plain
 * text into `<br>` and would strip most markup anyway. The title says what the
 * learner will be able to do, not the topic's name.
 */
@Injectable()
export class CourseMetaSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(input: CourseMetaInput): Promise<CourseMetaOutput> {
    const { brief, blueprint } = input;
    const { data } = await this.llm.runJson({
      specialist: 'course_meta',
      promptCode: COURSE_COPILOT_PROMPTS.COURSE_META,
      taskId: COURSE_COPILOT_AI_TASKS.META,
      task: LlmTask.COURSE_COPILOT_META,
      maxTokens: SPECIALIST_MAX_TOKENS.META,
      usageMetadata: input.usageMetadata,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint),
        working_title: blueprint?.title || '(none yet)',
        working_description: blueprint?.description || '(none yet)',
        duration_minutes: String(
          blueprint?.estimatedDurationMinutes ||
            brief?.shape?.durationMinutes ||
            '',
        ),
      },
    });
    return normaliseCourseMeta(data);
  }
}

/** Pure: raw model JSON → `{ title, description }`. Exported for tests. */
export function normaliseCourseMeta(
  raw: Record<string, any>,
): CourseMetaOutput {
  const root = isRecord(raw.course) ? raw.course : raw;
  const title = truncateAtWord(
    asText(root.title)
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\.$/, '')
      .trim(),
    COURSE_TITLE_MAX_CHARS,
  );

  const paragraphs = descriptionParagraphs(asText(root.description));
  // Two paragraphs, as asked; a third is folded into the second rather than
  // dropped, so nothing the model wrote about the course is lost.
  const kept =
    paragraphs.length > 2
      ? [paragraphs[0], paragraphs.slice(1).join(' ')]
      : paragraphs;
  const description = truncateAtWord(
    kept.join('\n\n'),
    COURSE_DESCRIPTION_MAX_CHARS,
  );

  const problems: string[] = [];
  if (!title) problems.push('The course needs a title.');
  if (!description) problems.push('The course needs a description.');
  if (problems.length) throw new SpecialistValidationError(problems);
  return { title, description };
}

function descriptionParagraphs(value: string): string[] {
  const hasMarkup = /<\/?[a-z][\s\S]*>/i.test(value);
  const text = hasMarkup
    ? value
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .split(/\n{2,}/)
        .map((part) => htmlToText(part))
        .join('\n\n')
    : value;
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/^\s*[-*#>]+\s*/gm, '')
        .replace(/\*\*|__/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}
