import { toGeminiParameters, toGeminiSchema } from '../gemini-schema.util';

describe('toGeminiSchema', () => {
  it('upper-cases types through nested properties and items', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: {
          age: { type: 'number' },
          samples: { type: 'array', items: { type: 'string' } },
          sources: {
            type: 'object',
            properties: { title: { type: 'string' } },
          },
        },
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: {
        age: { type: 'NUMBER' },
        samples: { type: 'ARRAY', items: { type: 'STRING' } },
        sources: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING' } },
        },
      },
    });
  });

  it('drops keywords outside the OpenAPI subset', () => {
    // Any one of these earns a 400 that names the field and takes the whole
    // interview turn down with it.
    const converted = toGeminiSchema({
      type: 'object',
      $schema: 'https://json-schema.org/draft-07/schema',
      additionalProperties: false,
      default: {},
      properties: { name: { type: 'string', description: 'Full name' } },
    });

    expect(converted).toEqual({
      type: 'OBJECT',
      properties: { name: { type: 'STRING', description: 'Full name' } },
    });
  });

  it('keeps enums on strings and strips them anywhere else', () => {
    expect(
      toGeminiSchema({ type: 'string', enum: ['male', 'female'] }),
    ).toEqual({ type: 'STRING', enum: ['male', 'female'] });
    expect(toGeminiSchema({ type: 'number', enum: [1, 2] })).toEqual({
      type: 'NUMBER',
    });
  });

  it('drops required names that are not declared properties', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name', 'ghost'],
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: { name: { type: 'STRING' } },
      required: ['name'],
    });
  });
});

describe('toGeminiParameters', () => {
  it('omits parameters for a no-argument tool', () => {
    // `get_voices` is declared as an object with no properties, which Gemini
    // rejects; the tool has to be sent with no parameters at all.
    expect(
      toGeminiParameters({ type: 'object', properties: {} }),
    ).toBeUndefined();
  });

  it('returns the converted schema for a tool that takes arguments', () => {
    expect(
      toGeminiParameters({
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: { prompt: { type: 'STRING' } },
      required: ['prompt'],
    });
  });
});
