import { Injectable } from '@nestjs/common';
import {
  ContextProvider,
  ChatContext,
} from 'src/ai-chat/interface/context-provider.interface';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenariosRepository } from '../repository/scenario.repository';

@Injectable()
export class ScenarioSessionContextProvider implements ContextProvider {
  constructor(
    private readonly scenarioSessionRepo: ScenarioSessionRepository,
    private readonly scenarioSessionMessageRepo: ScenarioSessionMessagesRepository,
    private readonly scenarioSessionDetailRepo: ScenarioSessionDetailsRepository,
    private readonly scenarioRepo: ScenariosRepository,
  ) {}

  async buildContext(scenarioSessionId: string): Promise<ChatContext> {
    const session = await this.scenarioSessionRepo.findOneOrFail({
      where: { id: scenarioSessionId },
    });

    const scenario = await this.scenarioRepo.findOneOrFail({
      where: { id: session.scenarioId },
    });

    const messages = await this.scenarioSessionMessageRepo.find({
      where: { scenarioSessionId },
      order: { startSeconds: 'ASC' },
    });

    const details = await this.scenarioSessionDetailRepo.findOne({
      where: { scenarioSessionId },
    });

    const formattedTranscript = messages
      .map(
        (m) =>
          `[${m.startSeconds ?? '?'}s - ${m.endSeconds ?? '?'}s] Sender ${m.senderId}: ${m.content}`,
      )
      .join('\n');

    const summaryStr = details?.summary
      ? JSON.stringify(details.summary, null, 2)
      : 'No summary available';

    return {
      systemPrompt: `You are an AI coaching assistant helping users improve their counseling skills based on a scenario simulation they completed.

## Scenario
- Title: ${scenario.title ?? 'N/A'}
- Description: ${scenario.description ?? 'N/A'}
- Difficulty: ${scenario.difficultyLevel ?? 'N/A'}

## Session Performance
- Overall Score: ${session.score ?? 'N/A'}
- Duration: ${details?.callDuration ? `${details.callDuration} seconds` : 'N/A'}
- Started: ${session.startedAt ?? 'N/A'}
- Ended: ${session.endedAt ?? 'N/A'}

## AI-Generated Summary / Report
${summaryStr}

## Conversation Transcript
${formattedTranscript}

## Instructions
- Respond in plain text only. Do not use markdown formatting such as bold (**), italics (*), headers (#), or bullet points (-).
- Use numbered lists with plain text (e.g., "1.", "2.") for structure.
- Use line breaks to separate sections clearly.
- Reference specific transcript moments (with timestamps) when giving feedback.
- Provide concrete alternative phrasings the user could have used.
- When the user asks "what could I have said better?", identify the weakest moments and provide before/after examples.
- Be encouraging but honest about areas for improvement.
- Keep responses focused and actionable.
- Consider the scenario context and difficulty level when evaluating responses.`,
      metadata: {
        scenarioId: session.scenarioId,
        scenarioSessionId,
        transcriptTurns: messages.length,
        callDuration: details?.callDuration,
      },
    };
  }
}
