import { Injectable } from '@nestjs/common';
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

@Injectable()
export class ScenarioSessionContextProvider implements ContextProvider {
  private readonly PROMPT_CODE = 'openai_scenario_session_chat';

  constructor(
    private readonly scenarioSessionRepo: ScenarioSessionRepository,
    private readonly scenarioSessionMessageRepo: ScenarioSessionMessagesRepository,
    private readonly scenarioSessionDetailRepo: ScenarioSessionDetailsRepository,
    private readonly scenarioRepo: ScenariosRepository,
    private readonly promptSharedService: PromptSharedService,
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

    // Get prompt template from database
    const promptTemplate =
      (await this.promptSharedService.getPromptByCode(this.PROMPT_CODE)) ||
      null;

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

    return {
      systemPrompt,
      metadata: {
        scenarioId: session.scenarioId,
        scenarioSessionId,
        transcriptTurns: transcriptMessages.length,
        callDuration: details?.callDuration,
        transcriptMessages,
        temperature,
      },
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
