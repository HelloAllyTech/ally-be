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
import { MAX_BEHAVIOR_INSTRUCTIONS_COUNT } from '../constants/scenario-behavior-instuctions.constants';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import {
  BehaviorIdMapping,
  GeneratedContent,
} from '../type/generatable-fields.type';
import { PREFERRED_AUTOFILL_MODELS } from '../constants/autofill-models.constants';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class OpenAIAutofillService {
  private readonly logger = LoggerService.getInstance(
    OpenAIAutofillService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  private modelsCache: { models: { value: string; label: string }[] } | null =
    null;
  private modelsCacheExpiry = 0;

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
        }> = parsed.instructions.slice(0, MAX_BEHAVIOR_INSTRUCTIONS_COUNT);

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

      case GeneratableField.LINGUISTIC_STYLE_SAMPLES: {
        const parsed = JSON.parse(raw);
        const samples = parsed?.samples;
        if (!Array.isArray(samples)) {
          return [];
        }
        return samples.filter(
          (s: unknown): s is string => typeof s === 'string' && s.trim() !== '',
        );
      }
    }
  }

  async getAvailableModels(): Promise<{ value: string; label: string }[]> {
    const now = Date.now();
    if (this.modelsCache && now < this.modelsCacheExpiry) {
      return this.modelsCache.models;
    }

    try {
      const apiModelIds = new Set<string>();
      for await (const model of this.client.models.list()) {
        apiModelIds.add(model.id);
      }

      const result: { value: string; label: string }[] = [];
      for (const modelId of PREFERRED_AUTOFILL_MODELS) {
        if (apiModelIds.has(modelId)) {
          result.push({ value: modelId, label: modelId });
        }
      }

      this.modelsCache = { models: result };
      this.modelsCacheExpiry = now + CACHE_TTL_MS;
      return result;
    } catch (error) {
      this.logger.error(
        'Failed to fetch available OpenAI models',
        error as any,
      );
      throw error;
    }
  }

  async generateFieldContent(
    fieldName: GeneratableField,
    promptCode: string,
    scenarioContext: ScenarioFieldContextDto,
    behaviorIdMapping?: BehaviorIdMapping,
    modelOverride?: string,
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
        model: modelOverride ?? this.model,
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
