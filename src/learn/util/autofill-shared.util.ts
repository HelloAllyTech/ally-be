import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { LoggerService } from 'src/logger/logger.service';

const logger = LoggerService.getInstance('autofillSharedUtil');
import {
  StateInstructionItem,
  BehaviorInstructionItem,
  KnowledgeSourceAutofillItem,
  SimulationStateAutofillItem,
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

    case GeneratableField.KNOWLEDGE_SOURCES: {
      const parsed = JSON.parse(raw);
      const sources = parsed?.sources;
      if (!Array.isArray(sources)) {
        return [] as KnowledgeSourceAutofillItem[];
      }
      // Coerce + drop entries missing either title or content. The studio
      // generates ids client-side; we don't carry them through here.
      return sources
        .map((s) => ({
          title: typeof s?.title === 'string' ? s.title.trim() : '',
          content: typeof s?.content === 'string' ? s.content.trim() : '',
        }))
        .filter(
          (s) => s.title.length > 0 && s.content.length > 0,
        ) as KnowledgeSourceAutofillItem[];
    }

    case GeneratableField.STATES: {
      const parsed = JSON.parse(raw);
      const states = parsed?.states;
      if (!Array.isArray(states)) return [] as SimulationStateAutofillItem[];
      // Coerce shapes defensively — the JSON schema constrains types but
      // belt-and-suspenders against any malformed entries. Caller is
      // responsible for assigning stable ids and running
      // validateSimulationStates against the contiguity / starting / gap
      // rules.
      return states.map((s, index) => {
        // Log when the LLM omits required fields the schema marks as
        // required. Defaulting silently can mask intent (e.g. an admin
        // expecting RAG off on a withdrawn state). Surfacing here gives
        // ops visibility into model misbehavior.
        if (typeof s?.ragEnabled !== 'boolean') {
          logger.warn(
            `STATES autofill: state at index ${index} missing required ` +
              `ragEnabled (got ${typeof s?.ragEnabled}); defaulting to true.`,
          );
        }
        if (typeof s?.isStarting !== 'boolean') {
          logger.warn(
            `STATES autofill: state at index ${index} missing required ` +
              `isStarting (got ${typeof s?.isStarting}); defaulting to false.`,
          );
        }
        return {
          name: typeof s?.name === 'string' ? s.name : '',
          guidelines: typeof s?.guidelines === 'string' ? s.guidelines : '',
          isStarting: Boolean(s?.isStarting),
          scoreLower: typeof s?.scoreLower === 'number' ? s.scoreLower : null,
          scoreUpper: typeof s?.scoreUpper === 'number' ? s.scoreUpper : null,
          ragEnabled: typeof s?.ragEnabled === 'boolean' ? s.ragEnabled : true,
        };
      }) as SimulationStateAutofillItem[];
    }
  }
}
