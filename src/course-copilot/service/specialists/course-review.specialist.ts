import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import { CourseReviewFinding, CourseReviewInput } from './specialist.types';
import {
  asArray,
  asText,
  briefForPrompt,
  isRecord,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

/**
 * Edit tools a finding may suggest — the edit-mode tools a trainer can apply
 * with one chip. Anything else the reviewer names is dropped (the finding
 * stays): a suggestion that cannot be executed is worse than none.
 */
export const COURSE_REVIEW_ACTION_TOOLS = [
  'regenerate_item',
  'update_item_content',
  'set_completion_rule',
  'update_course_meta',
  'add_item',
  'remove_item',
  'move_item',
] as const;

const NOTE_MAX_CHARS = 600;

/**
 * The critic pass after a build: one reviewer that did not write the course,
 * reading the outline and the inline content against a fixed rubric.
 *
 * Stacks: "Add Critic Agents to Review Generated Code" — a separate reviewer,
 * not the writers grading themselves. "Grounding: Aligning Responses to Rubric
 * Criteria" — the reviewer judges against an explicit, ordered rubric (outcome
 * coverage, assessment, progression, reflection, accuracy, duplication,
 * audience fit, safety, publish readiness) rather than general taste, which
 * is also what keeps it to ≤ 10 findings a trainer can act on.
 *
 * `fix` findings sort before `consider` ones. An `itemId` that does not appear
 * in the digest is removed rather than trusted — an invented id on a
 * one-click action would edit nothing, or the wrong thing.
 */
@Injectable()
export class CourseReviewSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async review(input: CourseReviewInput): Promise<CourseReviewFinding[]> {
    const { data } = await this.llm.runJson({
      specialist: 'course_review',
      promptCode: COURSE_COPILOT_PROMPTS.COURSE_REVIEWER,
      taskId: COURSE_COPILOT_AI_TASKS.REVIEW,
      task: LlmTask.COURSE_COPILOT_REVIEW,
      maxTokens: SPECIALIST_MAX_TOKENS.REVIEW,
      usageMetadata: input.usageMetadata,
      variables: {
        brief_json: briefForPrompt(input.brief),
        course_digest: input.courseDigest,
        max_findings: String(COURSE_COPILOT_LIMITS.reviewFindings),
        allowed_tools: COURSE_REVIEW_ACTION_TOOLS.join(', '),
      },
    });
    return normaliseReviewFindings(data, input.courseDigest);
  }
}

/** Pure: raw model JSON → findings. Exported for tests. */
export function normaliseReviewFindings(
  raw: Record<string, any>,
  courseDigest: string,
): CourseReviewFinding[] {
  const allowed = new Set<string>(COURSE_REVIEW_ACTION_TOOLS);
  const findings: CourseReviewFinding[] = [];

  for (const rawFinding of asArray(raw.findings ?? raw.issues).filter(
    isRecord,
  )) {
    const note = asText(rawFinding.note ?? rawFinding.message, NOTE_MAX_CHARS);
    if (!note) continue;
    const severityText = asText(rawFinding.severity).toLowerCase();
    const finding: CourseReviewFinding = {
      severity: ['fix', 'must', 'must-fix', 'high', 'blocker'].includes(
        severityText,
      )
        ? 'fix'
        : 'consider',
      note,
    };
    const itemId = asText(rawFinding.itemId);
    if (itemId && courseDigest.includes(itemId)) finding.itemId = itemId;

    const action = isRecord(rawFinding.suggestedAction)
      ? rawFinding.suggestedAction
      : undefined;
    const tool = asText(action?.tool);
    if (action && allowed.has(tool)) {
      finding.suggestedAction = {
        tool,
        input: isRecord(action.input) ? action.input : {},
      };
    }
    findings.push(finding);
  }

  // Stable sort: fixes first, the reviewer's own order within each.
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        Number(a.finding.severity !== 'fix') -
          Number(b.finding.severity !== 'fix') || a.index - b.index,
    )
    .map(({ finding }) => finding)
    .slice(0, COURSE_COPILOT_LIMITS.reviewFindings);
}
