import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  parseFirstJsonObject,
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBlueprint } from '../../type/course-copilot.type';
import {
  SpecialistContext,
  SpecialistValidationError,
} from './specialist.types';

/** Room for a reasoning model's thinking plus a 300-word brief in JSON. */
const ROLEPLAY_BRIEF_MAX_TOKENS = 4096;

/** Shorter than this is a sketch, not a brief the field chain can build from. */
const MIN_ACTOR_DESCRIPTION_CHARS = 200;
/** The prompt asks for ≤ 300 words; this only stops a runaway answer. */
const MAX_ACTOR_DESCRIPTION_CHARS = 4000;
/** The studio's title cap (agentBuilderApply MAX_LENGTHS.title). */
const MAX_TITLE_CHARS = 100;

export type RoleplayBriefDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

/** The Agent Builder chain's inputs that only a model can write. */
export interface RoleplayBriefOutput {
  actorDescription: string;
  agentTestCases: string;
  personaGender?: 'male' | 'female' | 'non-binary';
  personaAge?: number;
  title: string;
  difficultyLevel: RoleplayBriefDifficulty;
}

const PERSONA_GENDERS = new Set(['male', 'female', 'non-binary']);
const DIFFICULTIES = new Set<RoleplayBriefDifficulty>([
  'EASY',
  'MEDIUM',
  'HARD',
]);

/**
 * Where a slot's task class sits on the two axes the course varies, read from
 * the trainer's own words. Each axis scores 0 at its simple end; the sum is
 * the difficulty. Null on an axis means the task class says nothing about it.
 *
 * Stacks: "Define Task Classes via Simplifying Conditions Variation" — a task
 * class is named by the simplifying condition it varies, so the condition is
 * what difficulty should follow, not how the model happened to write the
 * client. Checked most-severe first, so "no longer cooperative, now
 * distressed" reads as distressed.
 */
const OPENNESS_LEVELS: [RegExp, number][] = [
  [
    /\b(distress|crisis|acute|panic|overwhelm|escalat|hostile|angry|agitat|suicid|self[- ]harm|in tears|sobbing)/i,
    2,
  ],
  [
    /\b(ambivalen|reluctan|resist|guarded|hesitan|defensive|withdrawn|mistrust|distrust|sceptic|skeptic|minimi[sz]|unsure|torn\b)/i,
    1,
  ],
  [
    /\b(cooperative|co-operative|willing|open\b|forthcoming|engaged|motivated)/i,
    0,
  ],
];
// Word-bounded so "network" is not "two" and "no one listens" is not "one concern".
const CONCERN_LEVELS: [RegExp, number][] = [
  [
    /\b(several|multiple|many|competing|two|three|complex|layered|tangled)\b/i,
    1,
  ],
  [/\b(one|a single|single)\s+(concern|issue|problem|worry|topic)/i, 0],
];

const levelOn = (text: string, levels: [RegExp, number][]): number | null => {
  for (const [pattern, level] of levels) {
    if (pattern.test(text)) return level;
  }
  return null;
};

/**
 * The difficulty a task class implies, or null when it names neither axis
 * (the model's own reading is then used). cooperative + one concern → EASY;
 * ambivalent, or several concerns → MEDIUM; distressed, or ambivalent with
 * several concerns → HARD.
 */
export const difficultyFromTaskClass = (
  taskClass: string | undefined,
): RoleplayBriefDifficulty | null => {
  const text = (taskClass ?? '').trim();
  if (!text) return null;
  const openness = levelOn(text, OPENNESS_LEVELS);
  const concerns = levelOn(text, CONCERN_LEVELS);
  if (openness === null && concerns === null) return null;
  const score = (openness ?? 0) + (concerns ?? 0);
  return score <= 0 ? 'EASY' : score === 1 ? 'MEDIUM' : 'HARD';
};

const text = (value: unknown, fallback = '—'): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const list = (value: unknown, fallback = '—'): string => {
  const items = (Array.isArray(value) ? value : [])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return items.length > 0 ? items.join('; ') : fallback;
};

/**
 * Course Copilot's roleplay brief writer: turns one ROLEPLAY slot of the
 * blueprint into the inputs AgentBuilderChainService takes — the actor
 * brief, agent test cases, persona hints, a title and a difficulty. One
 * `complete({ jsonMode: true })` call; the Agent Builder chain does the rest.
 *
 * The brief has to carry the slot's task class, because it is the only thing
 * the field chain reads: every persona, role instruction and opening line is
 * written from it. Two Stacks chunks shaped how the prompt describes the
 * harder classes: an ambivalent client is reluctant, not resistant — they
 * soften when invited and harden when pushed ("Resistance as Perceived
 * Coercion, Not Actual Coercion") — and a distressed client stays workable,
 * because practice that is only overwhelming teaches less ("Negative Emotions
 * Impair Learning and Cognitive Load").
 *
 * Difficulty follows the trainer's task class when it names one
 * (difficultyFromTaskClass), and the model's reading only when it does not.
 */
@Injectable()
export class RoleplayBriefSpecialist {
  private readonly logger = LoggerService.getInstance(
    RoleplayBriefSpecialist.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  async write(ctx: SpecialistContext): Promise<RoleplayBriefOutput> {
    const template = await this.promptSharedService.getPromptByCode(
      COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF,
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF}. ` +
          'It syncs from src/prompts/course_copilot/roleplay_brief.txt on ' +
          'startup; restart ally-be or check Prompt Management.',
      );
    }

    const response = await this.llmCompletion.complete({
      taskId: COURSE_COPILOT_AI_TASKS.ROLEPLAY_BRIEF,
      task: LlmTask.COURSE_COPILOT_ROLEPLAY_BRIEF,
      promptCode: COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF,
      prompt: renderTemplate(template, this.variables(ctx)),
      maxTokens: ROLEPLAY_BRIEF_MAX_TOKENS,
      jsonMode: true,
      usageMetadata: ctx.usageMetadata,
    });

    return this.parse(response.text, ctx);
  }

  private variables(ctx: SpecialistContext): Record<string, string> {
    const { brief, blueprint, section, item } = ctx;
    const spec = item.spec ?? {};
    const enabling = brief.outcomes?.enabling ?? [];
    const itemOutcomes = (item.objectiveRefs ?? [])
      .map((index) => enabling[index])
      .filter((o): o is string => typeof o === 'string' && o.trim() !== '');
    const triggerWarnings = Array.isArray(spec.triggerWarningIds)
      ? spec.triggerWarningIds
      : [];

    return {
      courseTitle: text(blueprint.title),
      audience: text(brief.audience?.who),
      priorExperience: text(brief.audience?.priorExperience),
      applicationContext: text(brief.audience?.applicationContext),
      competencies: list(brief.competencyNames),
      terminalOutcome: text(brief.outcomes?.terminal),
      itemOutcomes: list(itemOutcomes),
      helpfulBehaviours: list(brief.behaviours?.helpful),
      unhelpfulBehaviours: list(brief.behaviours?.unhelpful),
      courseNotes: list(brief.notes),
      sectionTitle: text(section.title),
      sectionPurpose: text(section.purpose),
      itemTitle: text(item.title),
      itemPurpose: text(item.purpose),
      personaBrief: text(spec.personaBrief, ''),
      taskClass: text(spec.taskClass),
      practiceSequence: this.practiceSequence(blueprint, item.id),
      sensitiveThemes:
        triggerWarnings.length > 0
          ? 'allowed — this roleplay carries trigger warnings'
          : 'none',
      revisionNotes: this.revisionNotes(ctx),
    };
  }

  /**
   * Every ROLEPLAY slot in course order, with its task class, so this brief
   * is written as one step in a progression rather than in isolation — the
   * earlier slots are what "everything else stays as simple" is measured
   * against.
   */
  private practiceSequence(blueprint: CourseBlueprint, itemId: string): string {
    const rows = (blueprint.sections ?? []).flatMap((section) =>
      (section.items ?? [])
        .filter((i) => i.type === 'ROLEPLAY')
        .map((i) => {
          const marker = i.id === itemId ? '>>' : '  ';
          return `${marker} ${text(i.title)} — task class: ${text(i.spec?.taskClass)}`;
        }),
    );
    return rows.length > 0 ? rows.join('\n') : '>> (this is the only one)';
  }

  /** A regeneration's previous brief and request, and a repair pass's errors. */
  private revisionNotes(ctx: SpecialistContext): string {
    const notes: string[] = [];
    if (ctx.previous) {
      notes.push(
        'You are revising an existing brief. Keep everything the trainer did ' +
          'not ask to change.\nPrevious output:\n' +
          JSON.stringify(ctx.previous.content) +
          `\nWhat the trainer asked for: ${ctx.previous.instructions}`,
      );
    }
    if (ctx.repairErrors?.length) {
      notes.push(
        'Your previous answer was rejected for these reasons; fix every one:\n' +
          ctx.repairErrors.map((e) => `- ${e}`).join('\n'),
      );
    }
    return notes.length > 0 ? `\n${notes.join('\n\n')}\n` : '';
  }

  /**
   * Validate the answer into chain inputs. Problems the model must fix are
   * thrown together as a SpecialistValidationError, which the build runner
   * feeds back as `repairErrors` on its one repair pass; recoverable
   * problems (a bad gender, a long title) are corrected here instead.
   */
  private parse(raw: string, ctx: SpecialistContext): RoleplayBriefOutput {
    const parsed = parseFirstJsonObject(stripMarkdownFences(raw ?? '')) ?? {};
    const errors: string[] = [];

    const actorDescription =
      typeof parsed.actorDescription === 'string'
        ? parsed.actorDescription.trim()
        : '';
    if (actorDescription.length < MIN_ACTOR_DESCRIPTION_CHARS) {
      errors.push(
        `actorDescription must be a 150–300 word brief (got ${actorDescription.length} characters)`,
      );
    }

    const title =
      typeof parsed.title === 'string'
        ? parsed.title.trim().replace(/^["']|["']$/g, '')
        : '';
    if (!title) errors.push('title is missing');

    // A list is a fair reading of "comma-separated phrases"; join it.
    const agentTestCases = Array.isArray(parsed.agentTestCases)
      ? parsed.agentTestCases
          .filter((v: unknown) => typeof v === 'string' && v.trim())
          .map((v: string) => v.trim())
          .join(', ')
      : typeof parsed.agentTestCases === 'string'
        ? parsed.agentTestCases.trim()
        : '';
    if (!agentTestCases) errors.push('agentTestCases is missing');

    if (errors.length > 0) throw new SpecialistValidationError(errors);

    const gender =
      typeof parsed.personaGender === 'string'
        ? parsed.personaGender.trim().toLowerCase()
        : '';
    const age = Number(parsed.personaAge);
    const modelDifficulty =
      typeof parsed.difficulty === 'string'
        ? (parsed.difficulty.trim().toUpperCase() as RoleplayBriefDifficulty)
        : undefined;
    const fromTaskClass = difficultyFromTaskClass(ctx.item.spec?.taskClass);
    const difficultyLevel: RoleplayBriefDifficulty =
      fromTaskClass ??
      (modelDifficulty && DIFFICULTIES.has(modelDifficulty)
        ? modelDifficulty
        : 'MEDIUM');
    if (
      fromTaskClass &&
      modelDifficulty &&
      DIFFICULTIES.has(modelDifficulty) &&
      modelDifficulty !== fromTaskClass
    ) {
      this.logger.info(
        `[COURSE_COPILOT] roleplay brief for item ${ctx.item.id}: model read ` +
          `${modelDifficulty}, task class says ${fromTaskClass}; using the task class`,
      );
    }

    return {
      actorDescription: actorDescription.slice(0, MAX_ACTOR_DESCRIPTION_CHARS),
      agentTestCases,
      ...(PERSONA_GENDERS.has(gender)
        ? { personaGender: gender as RoleplayBriefOutput['personaGender'] }
        : {}),
      ...(Number.isInteger(age) && age >= 16 && age <= 90
        ? { personaAge: age }
        : {}),
      title: title.slice(0, MAX_TITLE_CHARS).trim(),
      difficultyLevel,
    };
  }
}
