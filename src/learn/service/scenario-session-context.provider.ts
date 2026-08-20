import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ContextProvider,
  ChatContext,
} from 'src/ai-chat/interface/context-provider.interface';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenariosRepository } from '../repository/scenario.repository';
import { formatSecondsToMMSS } from 'src/common/util/time.util';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { User } from 'src/user/entity/user.entity';
import { WorkerType, resolveWorkerType } from 'src/user/enum/user.enum';

/**
 * Register guidance for the post-debrief "Ask AI" chat, keyed by the
 * learner's worker type. This changes HOW Ally talks — vocabulary, directness,
 * how much is spelled out — never WHAT is evaluated: the underlying skill
 * standard is identical across all three tiers, only the register adapts.
 *
 * Mirrors the register split used when the debrief note itself is generated
 * (ally-ai app/prompts/shared/worker_type_*.txt) so the chat that follows the
 * note doesn't shift voice partway through the conversation.
 */
const WORKER_TYPE_CHAT_GUIDANCE: Record<WorkerType, string> = {
  [WorkerType.LAY]: `This learner is not clinically trained. Use plain, everyday
language with no clinical or academic terminology — say what a skill actually
is in ordinary words instead of naming it. Be noticeably encouraging and keep
any suggestion concrete enough that they could repeat it almost word for
word.`,
  [WorkerType.EARLY_PROFESSIONAL]: `This learner is clinically trained but
early in practice. Use clinical terminology naturally and name the technique
as well as its effect. Where useful, connect a moment to the framework behind
it so the principle transfers beyond this scenario. Be directive — say
clearly what you would have done and why.`,
  [WorkerType.EXPERIENCED_PROFESSIONAL]: `This learner is a seasoned
practitioner. Write as a peer in consultation, not as a teacher to a student
— skip foundational explanations entirely. Go to nuance and tradeoffs, prefer
questions over directives, and invite them to evaluate their own choices
rather than instructing them.`,
};

@Injectable()
export class ScenarioSessionContextProvider implements ContextProvider {
  private readonly PROMPT_CODE = 'openai_scenario_session_chat';

  constructor(
    private readonly scenarioSessionRepo: ScenarioSessionRepository,
    private readonly scenarioSessionMessageRepo: ScenarioSessionMessagesRepository,
    private readonly scenarioSessionDetailRepo: ScenarioSessionDetailsRepository,
    private readonly scenarioRepo: ScenariosRepository,
    private readonly promptSharedService: PromptSharedService,
    private readonly dataSource: DataSource,
  ) {}

  async buildContext(scenarioSessionId: string): Promise<ChatContext> {
    const session = await this.scenarioSessionRepo.findOneOrFail({
      where: { id: scenarioSessionId },
    });

    const scenario = await this.scenarioRepo.findOneOrFail({
      where: { id: session.scenarioId },
    });

    const transcriptMessages = await this.scenarioSessionMessageRepo.find({
      where: { scenarioSessionId },
      order: { startSeconds: 'ASC' },
    });

    const details = await this.scenarioSessionDetailRepo.findOne({
      where: { scenarioSessionId },
    });

    const formattedTranscript = transcriptMessages
      .map((m) => {
        const ts = formatSecondsToMMSS(m.startSeconds);
        return ts
          ? `[${ts}] Sender ${m.senderId}: ${m.content}`
          : `Sender ${m.senderId}: ${m.content}`;
      })
      .join('\n');

    const summaryStr = details?.summary
      ? JSON.stringify(details.summary, null, 2)
      : 'No summary available';

    const supervisorNote =
      (details?.summary as Record<string, any> | undefined)?.feedback
        ?.supervisorNote || 'No debrief note was generated for this session.';

    // Resolved off the injected DataSource rather than a user-service
    // provider: importing anything from src/user/service/* into this graph
    // has previously broken Nest boot with a circular DI import.
    const learnerUser = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: session.counselorId } });

    // First name only — a supervisor addresses the learner the way they
    // would in person, and a full legal name reads like a form letter.
    const learnerName = learnerUser?.name?.trim().split(/\s+/)[0] || '';

    const workerType = resolveWorkerType(learnerUser?.metadata);
    const workerTypeGuidance = WORKER_TYPE_CHAT_GUIDANCE[workerType];

    // Get prompt template from database
    const promptTemplate =
      (await this.promptSharedService.getPromptByCode(this.PROMPT_CODE)) ||
      null;

    // Prompt-level LLM model/temperature override for the chat prompt, applied
    // by the chat service under the simulation temperature.
    const promptLlmConfig = await this.promptSharedService.getPromptLlmConfig(
      this.PROMPT_CODE,
    );

    // Prepare template variables
    const templateVariables: Record<string, string> = {
      scenarioTitle: scenario.title ?? 'N/A',
      scenarioDescription: scenario.description ?? 'N/A',
      scenarioDifficulty: scenario.difficultyLevel ?? 'N/A',
      sessionScore: session.score?.toString() ?? 'N/A',
      callDuration: details?.callDuration
        ? `${details.callDuration} seconds`
        : 'N/A',
      sessionStartedAt: session.startedAt
        ? new Date(session.startedAt).toISOString()
        : 'N/A',
      sessionEndedAt: session.endedAt
        ? new Date(session.endedAt).toISOString()
        : 'N/A',
      sessionSummary: summaryStr,
      sessionTranscript: formattedTranscript,
      supervisorNote,
      learnerName,
      workerTypeGuidance,
    };

    let systemPrompt = '';
    if (promptTemplate) {
      systemPrompt = this.renderTemplate(promptTemplate, templateVariables);
    }
    // Per-simulation LLM temperature lives on scenarios.metadata (JSONB).
    // Surface it so the chat service can apply it, falling back to the global
    // default when unset/invalid.
    const rawTemperature = (
      scenario.metadata as Record<string, any> | undefined
    )?.temperature;
    const temperature =
      typeof rawTemperature === 'number' && Number.isFinite(rawTemperature)
        ? rawTemperature
        : undefined;

    // Built as a loosely-typed record (rather than inline on the return
    // literal) so `workerType` can ride along for observability without
    // editing the shared ChatContext['metadata'] shape declared in
    // src/ai-chat/interface/context-provider.interface.ts, which is out of
    // scope for this change.
    const metadata: Record<string, unknown> = {
      scenarioId: session.scenarioId,
      scenarioSessionId,
      transcriptTurns: transcriptMessages.length,
      callDuration: details?.callDuration,
      transcriptMessages,
      temperature,
      promptProvider: promptLlmConfig.provider,
      promptModel: promptLlmConfig.model,
      promptTemperature: promptLlmConfig.temperature,
      workerType,
    };

    return {
      systemPrompt,
      metadata,
    };
  }

  /**
   * Render template with variables, supporting {{var}} format
   */
  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return variables[key] ?? '';
    });
  }
}
