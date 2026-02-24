import type { ResponseFormatJSONSchema } from 'openai/resources';
import { GeneratableField } from '../enum/generatable-field.enum';

const STATE_INSTRUCTION_OBJECT = {
  type: 'object',
  properties: {
    instruction: { type: 'string' },
    dialogues: { type: 'array', items: { type: 'string' } },
  },
  required: ['instruction', 'dialogues'],
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
          },
          required: ['category', 'helper_behavior_ids', 'actor_response'],
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
};
