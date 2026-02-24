import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ScenarioFieldContextDto } from '../dto/generate-scenario-field.dto';
import { GeneratableField } from '../enum/generatable-field.enum';
import {
  StateInstructionItem,
  BehaviorInstructionItem,
} from '../dto/generate-scenario-field-response.dto';
import { STRUCTURED_OUTPUT_SCHEMAS } from '../constants/autofill-structured-output.constants';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import {
  BehaviorIdMapping,
  GeneratedContent,
} from '../type/generatable-fields.type';

@Injectable()
export class OpenAIAutofillService {
  private readonly logger = LoggerService.getInstance(
    OpenAIAutofillService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
  ) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.autofillModel;
  }

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return variables[key] ?? '';
    });
  }

  private buildTemplateVariables(
    scenarioContext: ScenarioFieldContextDto,
  ): Record<string, string> {
    const variables: Record<string, string> = {};

    for (const [key, value] of Object.entries(scenarioContext)) {
      variables[key] =
        value == null ? '' : typeof value === 'string' ? value : String(value);
    }

    return variables;
  }

  buildBehaviorIdMapping(behaviors: BehaviorResponseDto[]): {
    mapping: BehaviorIdMapping;
    formattedList: string;
  } {
    const mapping: BehaviorIdMapping = new Map();
    const lines = behaviors.map((behavior, index) => {
      const seqId = index + 1;
      mapping.set(seqId, { id: behavior.id, name: behavior.name });
      return `${seqId}. ${behavior.name}`;
    });

    return { mapping, formattedList: lines.join('\n') };
  }

  private extractContent(
    fieldName: GeneratableField,
    raw: string,
    behaviorIdMapping?: BehaviorIdMapping,
  ): GeneratedContent {
    switch (fieldName) {
      case GeneratableField.CHARACTER_PROFILE_TEXT:
      case GeneratableField.DESCRIPTION:
        return raw;

      case GeneratableField.OPENING_STATEMENTS: {
        const parsed = JSON.parse(raw);
        return parsed.statements as string[];
      }

      case GeneratableField.STATE_INSTRUCTIONS: {
        const parsed = JSON.parse(raw);
        return Object.entries(parsed).map(([key, value]: [string, any]) => ({
          stateId: key.replace('state_', ''),
          instruction: value.instruction,
          dialogues: value.dialogues,
        })) as StateInstructionItem[];
      }

      case GeneratableField.BEHAVIOR_INSTRUCTIONS: {
        const parsed = JSON.parse(raw);
        const items: Array<{
          category: string;
          helper_behavior_ids: number[];
          actor_response: string;
        }> = parsed.instructions;

        return items.map((item) => {
          const behaviors = item.helper_behavior_ids
            .map((seqId) => behaviorIdMapping?.get(seqId))
            .filter(
              (behavior): behavior is BehaviorResponseDto =>
                behavior !== undefined,
            );

          return {
            category: item.category as BehaviorInstructionCategory,
            behaviors,
            instructions: [item.actor_response],
          };
        }) as BehaviorInstructionItem[];
      }
    }
  }

  async generateFieldContent(
    fieldName: GeneratableField,
    promptCode: string,
    scenarioContext: ScenarioFieldContextDto,
    behaviorIdMapping?: BehaviorIdMapping,
  ): Promise<GeneratedContent> {
    const promptTemplate =
      await this.promptSharedService.getPromptByCode(promptCode);

    if (!promptTemplate) {
      throw new NotFoundException(
        `Prompt template not found for code: ${promptCode}`,
      );
    }

    const templateVariables = this.buildTemplateVariables(scenarioContext);

    const renderedPrompt = this.renderTemplate(
      promptTemplate,
      templateVariables,
    );

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: renderedPrompt },
      ];

      const jsonSchema = STRUCTURED_OUTPUT_SCHEMAS[fieldName];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        ...(jsonSchema && {
          response_format: {
            type: 'json_schema',
            json_schema: jsonSchema,
          },
        }),
      });

      const content = response.choices?.[0]?.message?.content ?? '';

      if (!content || content.trim() === '') {
        throw new InternalServerErrorException(
          `Empty response from OpenAI for prompt code: ${promptCode}`,
        );
      }

      return this.extractContent(fieldName, content.trim(), behaviorIdMapping);
    } catch (error) {
      this.logger.error(
        `Error generating content for prompt code: ${promptCode}`,
        error as any,
      );
      throw error;
    }
  }
}
