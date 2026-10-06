import { Injectable } from '@nestjs/common';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  FEEDBACK_SKILL_MAPPER_MODEL,
  FEEDBACK_SKILL_MAPPER_TASK_ID,
  FEEDBACK_SKILL_MAPPER_VERSION,
} from '../constants/feedback-skill-mapper.constants';
import { StoredFeedbackSkillItem } from '../entity/session-feedback-skill-link.entity';
import {
  DebriefImprovement,
  buildMapperSystemPrompt,
  buildMapperUserPrompt,
  parseMapperReply,
} from '../util/feedback-skill-mapping.util';

export interface MapperOutcome {
  items: StoredFeedbackSkillItem[];
  invalidKeys: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * The one model call of the feedback → skill mapping: every improvement in one
 * session's debrief, batched into a single call, each filed under one
 * foundational helping skill key or null.
 *
 * Everything that makes it the mapping — prompt, pinned model, temperature 0,
 * JSON mode, validation — lives here, so a session can only ever be mapped one
 * way under one `FEEDBACK_SKILL_MAPPER_VERSION`.
 */
@Injectable()
export class FeedbackSkillMapperService {
  constructor(private readonly llm: LlmCompletionService) {}

  /**
   * Map one debrief's items. Throws on a transport failure, an unparseable
   * reply or a reply that skips an item; the caller records the attempt. A
   * reply naming a key outside the rubric is NOT a failure — that item is
   * stored as null and counted.
   */
  async map(
    items: readonly DebriefImprovement[],
    meta: { sessionId: string; userId: number },
  ): Promise<MapperOutcome> {
    const result = await this.llm.complete({
      taskId: FEEDBACK_SKILL_MAPPER_TASK_ID,
      task: LlmTask.FEEDBACK_IMPROVEMENT_SKILL_MAPPING,
      model: FEEDBACK_SKILL_MAPPER_MODEL,
      temperature: 0,
      system: buildMapperSystemPrompt(),
      prompt: buildMapperUserPrompt(items),
      jsonMode: true,
      // ~20 tokens of JSON per item; the item cap keeps this far above need.
      maxTokens: 1000,
      timeoutMs: 60_000,
      // One call maps exactly one session, so its spend is attributed to it —
      // where it reads as analysis spend beside the session's delivery cost,
      // never inside it (the task is absent from
      // SESSION_COST_COMPONENT_BY_TASK and TASK_AREA), like the benchmark judge.
      scenarioSessionId: meta.sessionId,
      usageMetadata: {
        mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
        sessionId: meta.sessionId,
        items: items.length,
      },
    });

    const parsed = parseMapperReply(result.text, items);
    return {
      items: parsed.items,
      invalidKeys: parsed.invalidKeys,
      model: result.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
    };
  }
}
