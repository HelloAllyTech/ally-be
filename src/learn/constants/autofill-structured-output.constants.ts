import type { ResponseFormatJSONSchema } from 'openai/resources';
import { GeneratableField } from '../enum/generatable-field.enum';

const STATE_INSTRUCTION_OBJECT = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    instruction: { type: 'string' },
    dialogues: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'instruction', 'dialogues'],
  additionalProperties: false,
};

const OPENING_STATEMENTS_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'opening_statements',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      statements: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['statements'],
    additionalProperties: false,
  },
};

const STATE_INSTRUCTIONS_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'state_instructions',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      state_1: STATE_INSTRUCTION_OBJECT,
      state_2: STATE_INSTRUCTION_OBJECT,
      state_3: STATE_INSTRUCTION_OBJECT,
      state_4: STATE_INSTRUCTION_OBJECT,
    },
    required: ['state_1', 'state_2', 'state_3', 'state_4'],
    additionalProperties: false,
  },
};

const LINGUISTIC_STYLE_SAMPLES_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'linguistic_style_samples',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      samples: {
        type: 'array',
        items: { type: 'string' },
        minItems: 10,
        maxItems: 10,
      },
    },
    required: ['samples'],
    additionalProperties: false,
  },
};

const ALLOWED_FILLER_WORDS_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'allowed_filler_words',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      fillers: {
        type: 'array',
        items: { type: 'string' },
        minItems: 6,
        maxItems: 14,
      },
    },
    required: ['fillers'],
    additionalProperties: false,
  },
};

const BEHAVIOR_INSTRUCTION_STATE_ITEM = {
  type: 'object',
  properties: {
    stateId: { type: 'string', enum: ['-1', '1', '2', '3'] },
    instruction: { type: 'string' },
  },
  required: ['stateId', 'instruction'],
  additionalProperties: false,
};

const BEHAVIOR_INSTRUCTIONS_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'behavior_instructions',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      instructions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['SHOULD_DO', 'SHOULD_NOT_DO'],
            },
            helper_behavior_ids: {
              type: 'array',
              items: { type: 'number' },
            },
            actor_response: { type: 'string' },
            stateInstructions: {
              type: 'array',
              items: BEHAVIOR_INSTRUCTION_STATE_ITEM,
              minItems: 4,
              maxItems: 4,
            },
          },
          required: [
            'category',
            'helper_behavior_ids',
            'actor_response',
            'stateInstructions',
          ],
          additionalProperties: false,
        },
      },
      state_names: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stateId: { type: 'string', enum: ['-1', '1', '2', '3'] },
            name: { type: 'string' },
          },
          required: ['stateId', 'name'],
          additionalProperties: false,
        },
        minItems: 4,
        maxItems: 4,
      },
    },
    required: ['instructions', 'state_names'],
    additionalProperties: false,
  },
};

/**
 * Per-simulation states autofill schema. Each item describes one state
 * card in the studio editor; constraints (one starting, contiguous,
 * min gap 50, open bounds at ends) are enforced by `validateSimulationStates`
 * after parsing. We don't try to encode contiguity / min-gap in JSON Schema
 * because OpenAI's strict mode doesn't support that level of conditional
 * validation; the post-parse validation handles it.
 */
const STATES_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'simulation_states',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      states: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            guidelines: { type: 'string' },
            isStarting: { type: 'boolean' },
            scoreLower: { type: ['integer', 'null'] },
            scoreUpper: { type: ['integer', 'null'] },
            ragEnabled: { type: 'boolean' },
          },
          required: [
            'name',
            'guidelines',
            'isStarting',
            'scoreLower',
            'scoreUpper',
            'ragEnabled',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['states'],
    additionalProperties: false,
  },
};

/**
 * Per-simulation knowledge sources schema. Each entry is a self-contained
 * narrative document the agent can draw from via RAG. The LLM uses the
 * `title` to decide relevance per turn, then injects `content` into the
 * prompt's `{retrieved_context}` slot. Counts and content lengths are
 * left to the prompt template's guidance — schema only enforces shape.
 */
const KNOWLEDGE_SOURCES_SCHEMA: ResponseFormatJSONSchema.JSONSchema = {
  name: 'knowledge_sources',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['title', 'content'],
          additionalProperties: false,
        },
      },
    },
    required: ['sources'],
    additionalProperties: false,
  },
};

export const STRUCTURED_OUTPUT_SCHEMAS: Partial<
  Record<GeneratableField, ResponseFormatJSONSchema.JSONSchema>
> = {
  [GeneratableField.OPENING_STATEMENTS]: OPENING_STATEMENTS_SCHEMA,
  [GeneratableField.STATE_INSTRUCTIONS]: STATE_INSTRUCTIONS_SCHEMA,
  [GeneratableField.BEHAVIOR_INSTRUCTIONS]: BEHAVIOR_INSTRUCTIONS_SCHEMA,
  [GeneratableField.LINGUISTIC_STYLE_SAMPLES]: LINGUISTIC_STYLE_SAMPLES_SCHEMA,
  [GeneratableField.ALLOWED_FILLER_WORDS]: ALLOWED_FILLER_WORDS_SCHEMA,
  [GeneratableField.STATES]: STATES_SCHEMA,
  [GeneratableField.KNOWLEDGE_SOURCES]: KNOWLEDGE_SOURCES_SCHEMA,
};
