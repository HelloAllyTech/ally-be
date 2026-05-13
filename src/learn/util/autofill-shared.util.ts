import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import {
  StateInstructionItem,
  BehaviorInstructionItem,
} from '../dto/generate-scenario-field-response.dto';
import { ScenarioFieldContextDto } from '../dto/generate-scenario-field.dto';
import { STRUCTURED_OUTPUT_SCHEMAS } from '../constants/autofill-structured-output.constants';
import { MAX_BEHAVIOR_INSTRUCTIONS_COUNT } from '../constants/scenario-behavior-instuctions.constants';
import {
  BehaviorIdMapping,
  BehaviorInstructionsWithStateNames,
  GeneratedContent,
} from '../type/generatable-fields.type';

export const AUTOFILL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '')
    .replace(/<(\w+)>/g, (match, key) =>
      key in variables ? String(variables[key] ?? '') : match,
    );
}

export function buildTemplateVariables(
  scenarioContext: ScenarioFieldContextDto,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(scenarioContext)) {
    variables[key] =
      value == null ? '' : typeof value === 'string' ? value : String(value);
  }
  return variables;
}

export function buildBehaviorIdMapping(behaviors: BehaviorResponseDto[]): {
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

export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

export function buildJsonSchemaSuffix(fieldName: GeneratableField): string {
  const schemaEntry = STRUCTURED_OUTPUT_SCHEMAS[fieldName];
  if (!schemaEntry) return '';
  const jsonSchema = JSON.stringify(schemaEntry.schema, null, 2);
  return `\n\nRespond with valid JSON only. Do not include markdown code fences or any explanation. Your response must conform exactly to this JSON schema:\n${jsonSchema}`;
}

export function extractContent(
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
        name: value.name,
        instruction: value.instruction,
        dialogues: value.dialogues,
      })) as StateInstructionItem[];
    }

    case GeneratableField.BEHAVIOR_INSTRUCTIONS: {
      const parsed = JSON.parse(raw);
      const rawInstructions = Array.isArray(parsed.instructions)
        ? parsed.instructions
        : [];
      const items: Array<{
        category: string;
        helper_behavior_ids: number[];
        stateInstructions?: Array<{
          stateId: string | number;
          instruction?: string;
        }>;
      }> = rawInstructions.slice(0, MAX_BEHAVIOR_INSTRUCTIONS_COUNT);

      const instructions = items.map((item) => {
        const behaviors = item.helper_behavior_ids
          .map((seqId) => behaviorIdMapping?.get(seqId))
          .filter(
            (behavior): behavior is BehaviorResponseDto =>
              behavior !== undefined,
          );

        const stateInstructions = (item.stateInstructions ?? []).map((si) => ({
          stateId: String(si.stateId),
          instruction: si.instruction ?? '',
        }));

        return {
          category: item.category as BehaviorInstructionCategory,
          behaviors,
          stateInstructions,
        };
      }) as BehaviorInstructionItem[];

      const stateNames = (parsed.state_names ?? []).map(
        (sn: { stateId: string; name: string }) => ({
          stateId: sn.stateId,
          name: sn.name,
        }),
      );

      return { instructions, stateNames } as BehaviorInstructionsWithStateNames;
    }

    case GeneratableField.LINGUISTIC_STYLE_SAMPLES: {
      const parsed = JSON.parse(raw);
      const samples = parsed?.samples;
      if (!Array.isArray(samples)) return [];
      return samples.filter(
        (s: unknown): s is string => typeof s === 'string' && s.trim() !== '',
      );
    }

    case GeneratableField.ALLOWED_FILLER_WORDS: {
      const parsed = JSON.parse(raw);
      const fillers = parsed?.fillers;
      if (!Array.isArray(fillers)) return [];
      return fillers.filter(
        (s: unknown): s is string => typeof s === 'string' && s.trim() !== '',
      );
    }
  }
}
