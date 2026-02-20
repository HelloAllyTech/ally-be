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
import { StateInstructionsContent } from '../dto/generate-scenario-field-response.dto';
import { STRUCTURED_OUTPUT_SCHEMAS } from '../constants/autofill-structured-output.constants';

type GeneratedContent = string | string[] | StateInstructionsContent;

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

  private extractContent(
    fieldName: GeneratableField,
    raw: string,
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
        return JSON.parse(raw) as StateInstructionsContent;
      }
    }
  }

  async generateFieldContent(
    fieldName: GeneratableField,
    promptCode: string,
    scenarioContext: ScenarioFieldContextDto,
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

      return this.extractContent(fieldName, content.trim());
    } catch (error) {
      this.logger.error(
        `Error generating content for prompt code: ${promptCode}`,
        error as any,
      );
      throw error;
    }
  }
}
