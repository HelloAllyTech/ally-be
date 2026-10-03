import { Injectable } from '@nestjs/common';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  FHS_JUDGE_MODEL,
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
  FhsBehaviour,
} from '../constants/helping-skills-rubric.constants';
import {
  SkillVerdict,
  NumberedLine,
  ValidationStats,
  compositeOf,
  parseJudgeReply,
  validateJudgement,
} from '../util/skill-scoring.util';

/** AI-task-registry row id for scoring a cut. */
export const FHS_JUDGE_TASK_ID = 'foundational-skills-judge';
/**
 * AI-task-registry row id for scoring a whole benchmark session. The same call
 * (rubric, prompt, pinned model) under its own row and usage label, so the
 * benchmark's spend is separable from the cut pipeline's.
 */
export const FHS_BENCHMARK_JUDGE_TASK_ID =
  'foundational-skills-benchmark-judge';

export interface JudgeOutcome {
  verdicts: SkillVerdict[];
  compositeScore: number | null;
  hasUnhelpfulBehaviour: boolean | null;
  stats: ValidationStats;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** The judge's instructions. Part of the ruler — edit only with a version bump. */
export function buildJudgeSystemPrompt(): string {
  const skills = FHS_RUBRIC.map((skill) => {
    const list = (title: string, behaviours: FhsBehaviour[]) =>
      behaviours.length === 0
        ? `  ${title}: (none)`
        : [
            `  ${title}:`,
            ...behaviours.map(
              (b) =>
                `    ${b.code}${b.absence ? ' [ABSENCE]' : ''}${
                  b.conditional ? ' [CONDITIONAL]' : ''
                } ${b.text}`,
            ),
          ].join('\n');
    return [
      `SKILL "${skill.key}" — ${skill.name}`,
      `  Opportunity: ${skill.opportunity}`,
      list('Unhelpful or potentially harmful', skill.unhelpful),
      list('Basic helping', skill.basic),
      list('Advanced helping', skill.advanced),
    ].join('\n');
  }).join('\n\n');

  return `You are a careful rater applying a structured helping-skills rubric to a transcript of roleplay practice.

The HELPER is a learner practising helping skills. The CLIENT is a simulated person played by an AI. You rate only the HELPER.

The transcript comes from speech-to-text: ignore transcription errors, missing punctuation and filler words. It may be in any language; judge meaning, not English phrasing.

## What you are given
- An optional CONTEXT block: earlier turns of the first session. Use it to understand the situation. Never cite it and never rate behaviour that happened in it.
- The SCORED WINDOW: numbered lines. [H4] is the helper's 4th line, [C4] the client's 4th line. Sessions are bracketed with whether their opening and their end are inside the window.

## How to rate each skill
For EVERY skill below:
1. Decide "opportunity": did the SCORED WINDOW give the helper a real opportunity to show this skill, per the skill's Opportunity rule? If not, set "opportunity": false and list nothing.
2. If there was an opportunity, list every behaviour code the helper demonstrated at least once in the scored window, each with the id of ONE line that shows it and an exact quote copied from that line (a short contiguous excerpt is fine). Behaviours described as "throughout" or "continuously" must hold across the window, not just once.
3. [ABSENCE] codes describe something the helper failed to do. Mark one only when the opportunity clearly arose in the scored window AND the helper then had room to act on it — either the session's end is inside the window, or the helper spoke at least 3 more times afterwards. For an [ABSENCE] code, cite the CLIENT line that created the opportunity.
4. [CONDITIONAL] codes react to something only the client can supply (feedback to adapt to, a positive coping strategy to praise). If the client never supplied it, put the code in "notApplicable" instead of leaving it out.
5. Do not assign levels or scores. Only report what you observed.

Be strict and literal: tick a behaviour only when a specific helper line shows it. When unsure, leave it out. A behaviour you cannot back with a real quote from the right speaker will be discarded.

## Rubric
${skills}

## Output
Return ONLY a JSON object, no prose, in exactly this shape, with one entry per skill (${FHS_RUBRIC.map((x) => `"${x.key}"`).join(', ')}):
{"skills":[{"skill":"verbal","opportunity":true,"observed":[{"code":"verbal.b1","line":"H3","quote":"how did that make you feel"}],"notApplicable":[]}, {"skill":"confidentiality","opportunity":false,"observed":[],"notApplicable":[]}]}`;
}

@Injectable()
export class FoundationalSkillsJudgeService {
  constructor(private readonly llm: LlmCompletionService) {}

  /**
   * Score one rendered cut. Throws on a transport failure or an unparseable
   * reply; the caller records the attempt. A reply that parses but backs few of
   * its ticks is NOT a failure — the dropped ticks are counted and stored.
   */
  async judge(
    windowText: string,
    lines: readonly NumberedLine[],
    meta: { cutId: string; userId: number; cutIndex: number },
  ): Promise<JudgeOutcome> {
    return this.run(windowText, lines, {
      taskId: FHS_JUDGE_TASK_ID,
      task: LlmTask.FOUNDATIONAL_SKILLS_ASSESSMENT,
      usageMetadata: {
        rubricVersion: FHS_RUBRIC_VERSION,
        cutId: meta.cutId,
        cutIndex: meta.cutIndex,
      },
    });
  }

  /**
   * Score one whole benchmark session — the identical judgement as
   * {@link judge}, tagged with the benchmark's own task id and usage label.
   * Same failure contract.
   */
  async judgeBenchmark(
    windowText: string,
    lines: readonly NumberedLine[],
    meta: { sessionId: string; userId: number; scenarioId: number },
  ): Promise<JudgeOutcome> {
    return this.run(windowText, lines, {
      taskId: FHS_BENCHMARK_JUDGE_TASK_ID,
      task: LlmTask.FOUNDATIONAL_SKILLS_BENCHMARK_JUDGE,
      usageMetadata: {
        rubricVersion: FHS_RUBRIC_VERSION,
        sessionId: meta.sessionId,
        scenarioId: meta.scenarioId,
      },
    });
  }

  /**
   * The one judgement both entry points share. Everything that makes it the
   * ruler — system prompt, pinned model, JSON mode, validation, level rule —
   * lives here, so a cut and a benchmark session can never be judged
   * differently; only the task tagging differs.
   */
  private async run(
    windowText: string,
    lines: readonly NumberedLine[],
    call: {
      taskId: string;
      task: LlmTask;
      usageMetadata: Record<string, unknown>;
    },
  ): Promise<JudgeOutcome> {
    const result = await this.llm.complete({
      taskId: call.taskId,
      task: call.task,
      model: FHS_JUDGE_MODEL,
      system: buildJudgeSystemPrompt(),
      prompt: windowText,
      jsonMode: true,
      // Reasoning models spend completion tokens thinking before they answer;
      // 14 skills with quotes is ~2–4k tokens of JSON on top of that.
      maxTokens: 16000,
      timeoutMs: 180_000,
      usageMetadata: call.usageMetadata,
    });

    const parsed = parseJudgeReply(result.text);
    if (!parsed || !Array.isArray(parsed.skills)) {
      throw new Error(
        'Judge reply was not a JSON object with a "skills" array',
      );
    }

    const { verdicts, stats } = validateJudgement(parsed.skills, lines);
    // The prompt demands one entry per skill. An omitted skill is not "no
    // opportunity" — it is an incomplete answer, and storing it as SCORED would
    // silently drop that skill from the composite (verbal is always assessable,
    // so a reply without it is wrong by construction). Fail the attempt so the
    // retry path gets another go.
    if (stats.missingSkills > 0) {
      throw new Error(
        `Judge reply omitted ${stats.missingSkills} of ${FHS_RUBRIC.length} skills`,
      );
    }
    const assessed = verdicts.filter((v) => v.level !== null);

    return {
      verdicts,
      compositeScore: compositeOf(verdicts),
      hasUnhelpfulBehaviour:
        assessed.length === 0 ? null : assessed.some((v) => v.level === 1),
      stats,
      model: result.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
    };
  }
}
