import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { stripMarkdownFences } from 'src/learn/util/autofill-shared.util';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

import { BUG_FIX_SESSION_REPOS } from '../constants/bug-fix-session.constants';
import {
  BUG_HUNTER_CLASSIFY_REPO_MAX_TOKENS,
  BUG_HUNTER_PROMPT_CODES,
} from '../constants/bug-hunter.constants';

export interface RepoClassification {
  /** A dispatchable repo, or null if the model couldn't tell or named ally-mobile. */
  repo: string | null;
  /** Set only when the model recognized this as an ally-mobile bug — not dispatchable from here. */
  notDispatchable: string | null;
  rationale: string;
}

const UNCLASSIFIED: RepoClassification = {
  repo: null,
  notDispatchable: null,
  rationale: '',
};

/**
 * Decides which repo a freshly human-reported bug belongs to, so an admin
 * starting a fix session is never asked to guess a codebase from free text
 * themselves — see BugFixSessionService.start.
 *
 * Same shape as RoadmapAiService.classifyGoal, including its guardrail:
 * an unvalidated model answer never becomes the repo a fix session dispatches
 * to. `repo` is null whenever the model's answer isn't a live entry in
 * BUG_FIX_SESSION_REPOS — including when it correctly says "ally-mobile",
 * which is a real repo but has no dispatchable fix-session workflow.
 */
@Injectable()
export class BugHunterRepoClassifierService {
  private readonly logger = LoggerService.getInstance(
    BugHunterRepoClassifierService.name,
  );
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  async classifyRepo(
    description: string,
    evidence?: string | null,
  ): Promise<RepoClassification> {
    const userMessage = evidence?.trim()
      ? `Bug description:\n"""\n${description}\n"""\n\nEvidence:\n"""\n${evidence}\n"""`
      : `Bug description:\n"""\n${description}\n"""`;

    const template = await this.promptSharedService.getPromptByCode(
      toPromptCode('bug_hunter', 'classify_repo'),
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${BUG_HUNTER_PROMPT_CODES.CLASSIFY_REPO}`,
      );
    }

    let raw: string | null;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: BUG_HUNTER_CLASSIFY_REPO_MAX_TOKENS,
        system: template,
        messages: [{ role: 'user', content: userMessage }],
      });

      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model: this.model,
        task: LlmTask.BUG_HUNTER,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        cachedTokens: response.usage?.cache_read_input_tokens ?? undefined,
        metadata: { feature: 'bug-hunter', label: 'classify-repo' },
      });

      const block = response.content?.[0];
      raw = block?.type === 'text' ? block.text : null;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Repo classification call failed, leaving repo unset: ${
          (error as Error)?.message
        }`,
      );
      return UNCLASSIFIED;
    }

    if (!raw) return UNCLASSIFIED;

    const cleaned = stripMarkdownFences(raw);
    let parsed: {
      repo?: string | null;
      notDispatchable?: string | null;
      confidence?: number;
      rationale?: string;
    } | null = null;
    for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!parsed) {
      this.logger.warn(
        `[BUG_HUNTER] classify-repo: model output was not parseable JSON: ${cleaned.slice(0, 200)}`,
      );
      return UNCLASSIFIED;
    }

    const repo = BUG_FIX_SESSION_REPOS.includes(parsed.repo as never)
      ? (parsed.repo as string)
      : null;
    if (!repo && parsed.repo) {
      this.logger.warn(
        `[BUG_HUNTER] classify-repo: model returned "${parsed.repo}", which is not a ` +
          `dispatchable repo. Discarding rather than dispatching a fix session to it.`,
      );
    }

    return {
      repo,
      notDispatchable: repo ? null : (parsed.notDispatchable ?? null),
      rationale: parsed.rationale ?? '',
    };
  }
}
