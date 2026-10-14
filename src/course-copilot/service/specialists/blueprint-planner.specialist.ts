import { Injectable, Logger } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_DEFAULT_ITEM_MINUTES,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBlueprint } from '../../type/course-copilot.type';
import {
  normaliseBlueprint,
  validateBlueprint,
} from '../../util/course-blueprint.util';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  BlueprintPlannerInput,
  SpecialistValidationError,
} from './specialist.types';
import { briefForPrompt, SPECIALIST_MAX_TOKENS } from './specialist.util';

/** Used for an hour-long course when the brief names no duration. */
const DEFAULT_DURATION_MINUTES = 60;

export interface BlueprintPlanOptions {
  /** `config.courseCopilot.maxNewRoleplays`; COURSE_COPILOT_LIMITS.newRoleplays when omitted. */
  maxNewRoleplays?: number;
}

/**
 * Drafts the course blueprint from the interview brief: one specialist call
 * with its own narrow prompt, not a second manager LLM (plan §2.4).
 *
 * The sequencing rules live in `blueprint_planner.txt`:
 * - Stacks: "Write Assessments First, Then Derive Objectives" — the brief's
 *   assessment is the capstone, placed last, and everything builds to it.
 * - "Organize Training via Task Classes from Simple to Complex" and "Define
 *   Task Classes via Simplifying Conditions Variation" — sections are whole
 *   versions of the task, each varying ONE simplifying condition.
 * - "Completion Strategy: Sequencing from Worked Examples to Independent
 *   Problems" — an annotated transcript precedes the first roleplay on the
 *   same behaviours, and later sections fade that support.
 * - "Four interrelated components of training blueprints" — supportive
 *   information (article / video) precedes the practice that needs it; no
 *   part-task drills in v1.
 * - "After-Action Review Deepens Reflection in Interactive Learning" — a
 *   journal follows every practice block.
 * - Games only as breaks, never last.
 *
 * Output is normalised in code (`normaliseBlueprint`). When the result still
 * has problems the planner could have avoided — limits, a case with one
 * roleplay, ending on a game — it gets ONE repair call with those problems,
 * and whichever attempt has fewer problems is returned; what remains is the
 * trainer's to resolve in the tree. Videos waiting for a link are warnings,
 * not problems, so they never trigger a repair.
 */
@Injectable()
export class BlueprintPlannerSpecialist {
  private readonly logger = new Logger(BlueprintPlannerSpecialist.name);

  constructor(private readonly llm: SpecialistLlmService) {}

  async plan(
    input: BlueprintPlannerInput,
    options: BlueprintPlanOptions = {},
  ): Promise<CourseBlueprint> {
    const maxNewRoleplays =
      options.maxNewRoleplays ?? COURSE_COPILOT_LIMITS.newRoleplays;
    const problemsOf = (blueprint: CourseBlueprint) =>
      validateBlueprint(blueprint, input.brief, { maxNewRoleplays });

    let first: CourseBlueprint;
    try {
      first = await this.attempt(input, maxNewRoleplays);
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      // Unparseable output: the one retry goes here instead.
      return this.attempt(input, maxNewRoleplays, error.errors);
    }

    const problems = problemsOf(first);
    if (!problems.length) return first;

    try {
      const second = await this.attempt(input, maxNewRoleplays, problems);
      return problemsOf(second).length < problems.length ? second : first;
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      this.logger.warn(
        `Blueprint repair for session ${input.sessionId} returned no JSON; keeping the first plan.`,
      );
      return first;
    }
  }

  private async attempt(
    input: BlueprintPlannerInput,
    maxNewRoleplays: number,
    repairErrors?: string[],
  ): Promise<CourseBlueprint> {
    const { brief } = input;
    const enabling = brief?.outcomes?.enabling ?? [];
    const { data } = await this.llm.runJson({
      specialist: 'blueprint_planner',
      promptCode: COURSE_COPILOT_PROMPTS.BLUEPRINT_PLANNER,
      taskId: COURSE_COPILOT_AI_TASKS.BLUEPRINT,
      task: LlmTask.COURSE_COPILOT_BLUEPRINT,
      maxTokens: SPECIALIST_MAX_TOKENS.BLUEPRINT,
      usageMetadata: input.usageMetadata,
      repairErrors,
      variables: {
        brief_json: briefForPrompt(brief),
        objectives_list: enabling.length
          ? enabling.map((outcome, index) => `${index}: ${outcome}`).join('\n')
          : '(none recorded — leave objectiveRefs empty)',
        trainer_notes: input.notes?.trim() || '(none)',
        library_picks_json: JSON.stringify(input.libraryPicks ?? [], null, 2),
        video_urls_json: JSON.stringify(
          (brief?.videoUrls ?? []).map((video, index) => ({ index, ...video })),
          null,
          2,
        ),
        games_json: JSON.stringify(input.games ?? [], null, 2),
        limits_json: JSON.stringify(
          {
            sections: COURSE_COPILOT_LIMITS.sections,
            items: COURSE_COPILOT_LIMITS.items,
            itemsPerSection: COURSE_COPILOT_LIMITS.itemsPerSection,
            newRoleplays: maxNewRoleplays,
            newCases: COURSE_COPILOT_LIMITS.newCases,
            images: COURSE_COPILOT_LIMITS.images,
            languagesPerRoleplay: COURSE_COPILOT_LIMITS.languagesPerRoleplay,
            quizQuestions: COURSE_COPILOT_LIMITS.quizQuestions,
            articleQuestions: COURSE_COPILOT_LIMITS.articleQuestions,
          },
          null,
          2,
        ),
        item_minutes_json: JSON.stringify(COURSE_COPILOT_DEFAULT_ITEM_MINUTES),
        duration_minutes: String(
          brief?.shape?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
        ),
        max_new_roleplays: String(maxNewRoleplays),
        max_article_questions: String(COURSE_COPILOT_LIMITS.articleQuestions),
        max_quiz_questions: String(COURSE_COPILOT_LIMITS.quizQuestions),
        max_labels: String(COURSE_COPILOT_LIMITS.annotationLabels),
      },
    });
    return normaliseBlueprint(data, brief);
  }
}
