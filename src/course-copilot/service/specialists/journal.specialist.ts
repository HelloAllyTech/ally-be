import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  JournalContent,
  JournalPrompt,
  TrackItemType,
} from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
} from './specialist.types';
import {
  asArray,
  asBoolean,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  briefForPrompt,
  clampInt,
  collectContentIds,
  courseOutlineForPrompt,
  describeItemForPrompt,
  IdMinter,
  isRecord,
  itemForPrompt,
  objectivesForPrompt,
  plural,
  precedingPracticeBlock,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

const DEFAULT_JOURNAL_PROMPTS = 3;
const PLACEHOLDER_MAX_CHARS = 120;
const PROMPT_MAX_CHARS = 600;

/**
 * Writes one JOURNAL item: the learner's after-action review of the practice
 * block it follows.
 *
 * Stacks: "After-Action Review Deepens Reflection in Interactive Learning" —
 * reflection after practice is where a simulation's lesson is drawn out, as
 * what happened, why it happened, and how to do it better next time. So the
 * prompt is handed the practice block itself (the roleplays, case or
 * annotated transcript immediately before the journal) and asked to name that
 * situation, not "How did it go?".
 *
 * Prompts default to required — a reflection the learner may skip in one tap
 * is the step that gets skipped — unless the model marks one optional.
 */
@Injectable()
export class JournalSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const promptCount = clampInt(
      item.spec?.promptCount,
      1,
      COURSE_COPILOT_LIMITS.journalPrompts,
      DEFAULT_JOURNAL_PROMPTS,
    );
    const block = precedingPracticeBlock(blueprint, item.id);

    const { data } = await this.llm.runJson({
      specialist: 'journal',
      promptCode: COURSE_COPILOT_PROMPTS.JOURNAL_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.JOURNAL,
      task: LlmTask.COURSE_COPILOT_JOURNAL,
      maxTokens: SPECIALIST_MAX_TOKENS.JOURNAL,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        preceding_practice: block.length
          ? block.map((entry) => `- ${describeItemForPrompt(entry)}`).join('\n')
          : '- (nothing precedes it — reflect on what the learner expects to find hard in this course)',
        prompt_count: String(promptCount),
      },
    });

    return normaliseJournalOutput(data, {
      title: item.title,
      promptCount,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
    });
  }
}

/** Pure: raw model JSON → validated JOURNAL content. Exported for tests. */
export function normaliseJournalOutput(
  raw: Record<string, any>,
  opts: { title: string; promptCount: number; keepIds: ReadonlySet<string> },
): SpecialistOutput {
  const root = isRecord(raw.journal) ? raw.journal : raw;
  const ids = new IdMinter(opts.keepIds);
  const prompts: JournalPrompt[] = [];
  for (const rawPrompt of asArray(root.prompts)) {
    if (prompts.length >= opts.promptCount) break;
    const entry = isRecord(rawPrompt) ? rawPrompt : { prompt: rawPrompt };
    const text = asText(entry.prompt ?? entry.text ?? entry.question);
    if (!text) continue;
    const prompt: JournalPrompt = {
      id: ids.mint(entry.id),
      prompt: text.slice(0, PROMPT_MAX_CHARS),
      required: asBoolean(entry.required) ?? true,
    };
    const placeholder = asText(entry.placeholder, PLACEHOLDER_MAX_CHARS);
    if (placeholder) prompt.placeholder = placeholder;
    prompts.push(prompt);
  }

  assertNoProblems(
    prompts.length ? [] : ['The journal has no reflection prompts.'],
  );
  const content: JournalContent = { prompts };
  assertTrackItemContent(TrackItemType.JOURNAL, content, opts.title);
  return {
    content: content as unknown as Record<string, any>,
    summary: plural(prompts.length, 'prompt'),
  };
}
