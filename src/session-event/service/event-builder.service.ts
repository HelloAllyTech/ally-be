import { Injectable } from '@nestjs/common';

import { AutofillService } from 'src/learn/service/autofill.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

import {
  GenerateEventBuilderFieldDto,
  GenerateEventBuilderFieldResponseDto,
} from '../dto/generate-event-builder-field.dto';
import {
  CLASSNAME_DEPENDENT_EVENT_BUILDER_FIELDS,
  DEFAULT_EXAMPLES_PER_POLARITY,
  EventBuilderField,
  MAX_EXAMPLES_PER_POLARITY,
} from '../enum/event-builder-field.enum';
import { parseEventBuilderField } from '../util/event-builder-parse.util';

/** The prompt subfolder: src/prompts/event_builder/<field>.txt. */
const PROMPT_GROUP = 'event_builder';

/**
 * Event Builder: turn a free-text description of a behaviour into the
 * configuration of a BINARY_CLASSIFIER session event, one field per call.
 *
 * Every field is prose-free JSON except `branch_instruction`, so `expectJson`
 * is on for all but that one.
 *
 * This service GENERATES ONLY — it writes nothing. The caller edits the values
 * and submits them through the ordinary create/update endpoints. That split is
 * deliberate: `session_events` has no tenant column, so an event row is visible
 * in every tenant's picker, and persisting on generate would litter a shared
 * catalogue with every abandoned attempt.
 */
@Injectable()
export class EventBuilderService {
  constructor(private readonly autofillService: AutofillService) {}

  async generateField(
    dto: GenerateEventBuilderFieldDto,
  ): Promise<GenerateEventBuilderFieldResponseDto> {
    const { field } = dto;

    const numExamples = Math.min(
      Math.max(dto.numExamples ?? DEFAULT_EXAMPLES_PER_POLARITY, 1),
      MAX_EXAMPLES_PER_POLARITY,
    );

    // `className` is only rendered for the fields that read it. Passing it to
    // `classifier` would let the prompt echo back the name it was asked to
    // write, turning a regenerate into a no-op.
    const usesClassName = CLASSNAME_DEPENDENT_EVENT_BUILDER_FIELDS.has(field);

    const variables: Record<string, string> = {
      eventDescription: dto.eventDescription?.trim() ?? '',
      className: usesClassName ? (dto.className?.trim() ?? '') : '',
      simulationContext: dto.simulationContext?.trim() ?? '',
      competency: dto.competency?.trim() ?? '',
      numExamples: String(numExamples),
    };

    const promptCode = toPromptCode(PROMPT_GROUP, field);
    const expectJson = field !== EventBuilderField.BRANCH_INSTRUCTION;

    const raw = await this.autofillService.generateContentFromPrompt(
      promptCode,
      variables,
      expectJson,
      dto.model,
      dto.temperature,
      dto.provider,
      LlmTask.AUTOFILL_EVENT_FIELD,
    );

    return { field, value: parseEventBuilderField(field, raw, numExamples) };
  }
}
