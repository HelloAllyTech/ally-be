import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderInterviewToolsService } from './builder-interview-tools.service';
import { BUILDER_MAX_TOKENS } from '../constants/builder.constants';

/** What the admin asked for. */
export type BuilderResearchMode = 'technical_plan' | 'draft_prd';

/**
 * "Research this for me": one server-side pass that reads the codebase and
 * writes into the PRD, instead of the admin waiting a turn per tool call.
 *
 * The interview already has every tool this needs. What it does not have is
 * permission to spend twenty minutes using them — a streamed turn is a
 * conversation, and a conversation where the other party goes quiet for twenty
 * tool calls is a bad one. So this is the same tools with a different budget
 * and no expectation of a reply.
 *
 * Deliberately one agentic loop rather than a fan-out of parallel researchers.
 * With a bounded tool budget the single loop captures most of the value at a
 * fraction of the complexity, and the failure mode of the fan-out — several
 * agents writing to one PRD at once — is the expensive kind. If this proves
 * too slow in practice, sharding it per repo is the upgrade.
 */
@Injectable()
export class BuilderResearchService {
  private readonly logger = LoggerService.getInstance(
    BuilderResearchService.name,
  );

  // Exposed for tests (mocked with a fake client), matching the orchestrator.
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly prdService: BuilderPrdService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly toolsService: BuilderInterviewToolsService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * Run the pass and write what it finds into the PRD.
   *
   * Writes go through `BuilderPrdService`, so the result is an ordinary
   * agent-authored version: it shows in the version history, it is diffable,
   * and an admin who dislikes it can revert it like any other edit. That is
   * the whole reason not to special-case the storage.
   */
  async run(
    session: BuilderSession,
    userId: number,
    mode: BuilderResearchMode,
  ): Promise<{ iterations: number; patched: boolean }> {
    if (
      session.status === 'BUILDING' ||
      session.status === 'WAITING_FOR_INPUT'
    ) {
      throw new BadRequestException(
        'A build is reading this PRD right now, so research cannot rewrite it.',
      );
    }

    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      userId,
      session.title,
    );
    const model = this.configService.builder.interviewModel;
    const context = await this.knowledgeService.buildContextBlock(
      session.repos ?? undefined,
    );

    // The read-only research tools plus `update_prd`. `ask_admin` is
    // deliberately absent: nobody is watching this run, and a question it
    // asked would stop the pass and be seen by no one.
    const tools = this.toolsService
      .getToolDefinitions()
      .filter((tool: any) => tool.name !== 'ask_admin');

    const messages: any[] = [
      { role: 'user', content: this.openingInstruction(mode, doc.draft) },
    ];

    let iterations = 0;
    let patched = false;
    const maxIterations = Math.max(
      8,
      Number(this.configService.builder.maxToolIterations) || 16,
    );

    while (iterations < maxIterations) {
      iterations += 1;

      const response = await this.client.messages.create({
        model,
        max_tokens: BUILDER_MAX_TOKENS,
        system: [
          { type: 'text', text: RESEARCH_SYSTEM_PROMPT },
          { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
        ] as any,
        messages,
        tools,
      });

      const usageInput = response.usage?.input_tokens ?? 0;
      const usageOutput = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model,
        task: LlmTask.BUILDER_RESEARCH,
        promptTokens: usageInput,
        completionTokens: usageOutput,
        totalTokens: usageInput + usageOutput,
        cachedTokens: response.usage?.cache_read_input_tokens ?? undefined,
        cacheCreationTokens:
          response.usage?.cache_creation_input_tokens ?? undefined,
        metadata: { builderSessionId: session.id, mode, iteration: iterations },
      });

      const toolUses = response.content.filter(
        (block: any) => block.type === 'tool_use',
      );
      if (!toolUses.length) break;

      messages.push({ role: 'assistant', content: response.content });

      const results: any[] = [];
      for (const toolUse of toolUses as any[]) {
        try {
          const result = await this.toolsService.execute(
            toolUse.name,
            toolUse.input,
            { session, doc, userId },
          );
          if (toolUse.name === 'update_prd') patched = true;
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result ?? { ok: true }),
          });
        } catch (error) {
          // Same contract as the interview: a tool error becomes a result the
          // model can read and work around, not an exception that ends the run.
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    this.logger.info(
      `Builder research (${mode}) on session ${session.id}: ${iterations} iteration(s), PRD ${
        patched ? 'updated' : 'unchanged'
      }.`,
    );
    return { iterations, patched };
  }

  private openingInstruction(
    mode: BuilderResearchMode,
    prd: Record<string, any>,
  ): string {
    const current = JSON.stringify(prd ?? {}, null, 2);

    if (mode === 'draft_prd') {
      return [
        'Draft this PRD from what you can find in the code.',
        '',
        'The admin has said what they want in the title and summary and little',
        'else. Read enough of the codebase to fill in a first draft they can',
        'correct — a draft to react to is worth far more than an empty document',
        'and a list of questions.',
        '',
        'Write the prose sections, the requirements with observable acceptance',
        'criteria, and the technical plan. Where you had to assume something,',
        'record it as an **unconfirmed** assumption rather than stating it as',
        'fact: the admin will confirm or correct each one.',
        '',
        '<current_prd>',
        current,
        '</current_prd>',
      ].join('\n');
    }

    return [
      'Fill in the technical plan for this PRD.',
      '',
      'The requirements are already written. Your job is the part that needs',
      'the codebase: which repos this lands in, which files and modules change',
      'in each, what the data model and API need, and what else depends on the',
      'code you are about to change.',
      '',
      'Do not rewrite the requirements or the prose sections — the admin wrote',
      'those and changing them under them is not what was asked for.',
      '',
      '<current_prd>',
      current,
      '</current_prd>',
    ].join('\n');
  }
}

const RESEARCH_SYSTEM_PROMPT = `
You are Builder's research pass. You read the Ally codebase and write what you
find into a PRD, using the same tools the interview uses.

Nobody is watching this run. That changes two things: you can afford to read
properly rather than guessing, and you must not ask questions — there is no one
to answer, and a question you asked would simply be lost.

## How to work

1. **Read the repo knowledge packs first** (in your context), then use
   \`github_repo_tree\`, \`github_search_code\` and \`github_read_file\` to
   confirm the specifics. The packs tell you where to look; only the code tells
   you what is actually there.
2. **Check the product library** with \`stacks_search\` when the PRD involves a
   product judgement — a threshold, a label, an empty or failure state.
3. **Write with \`update_prd\`** as you go, rather than saving it all for the
   end. A pass that dies halfway should leave the half it finished.

## What makes this useful

- **Name real things.** "Add a column to \`scenarios.metadata\`" is useful;
  "update the data model" is not. Every path, symbol and command you write
  should be one you actually saw.
- **Say what else breaks.** The most valuable thing you can contribute is the
  list of existing callers that will need to change — the part an implementer
  working file by file is worst placed to notice.
- **Mark what you assumed.** Anything you could not confirm in the code goes in
  \`assumptions\` as **unconfirmed**. A guess written as a fact is worse than no
  guess at all, because the next reader cannot tell the difference.
- **Do not pad.** A short technical plan that is entirely true beats a thorough
  one that is partly invented. If you could not work something out, say so in
  the plan.

When there is nothing left worth reading, stop and say briefly what you wrote
and what you could not determine.
`.trim();
