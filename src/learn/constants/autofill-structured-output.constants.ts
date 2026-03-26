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
    },
    required: ['instructions'],
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
};
