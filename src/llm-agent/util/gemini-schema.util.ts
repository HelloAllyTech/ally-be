/**
 * JSON Schema → Gemini function-declaration schema.
 *
 * Gemini accepts an OpenAPI-3.0 subset, not JSON Schema, and rejects the whole
 * request (400, naming one field) when it meets a keyword outside it. Two rules
 * do the work:
 *
 * - `type` is a protobuf enum, so it must be upper-cased. Lowercase `"string"`
 *   is the spelling every other provider takes and the one our tool
 *   definitions are written in.
 * - Unknown keywords are dropped rather than passed through. An allowlist is
 *   the right way round here: a schema silently losing `additionalProperties`
 *   costs nothing, while a schema that 400s takes the whole interview down.
 */

/** OpenAPI-subset keywords Gemini understands, minus the ones handled below. */
const SUPPORTED_KEYS = new Set([
  'description',
  'enum',
  'format',
  'nullable',
  'maxItems',
  'minItems',
  'required',
  'title',
]);

const TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
]);

export const toGeminiSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }

  const result: Record<string, any> = {};

  const type = String(schema.type ?? '').toLowerCase();
  if (TYPES.has(type)) {
    result.type = type.toUpperCase();
  }

  for (const [key, value] of Object.entries(schema)) {
    if (SUPPORTED_KEYS.has(key) && value !== undefined) {
      result[key] = value;
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    const properties: Record<string, any> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const converted = toGeminiSchema(child);
      if (converted) {
        properties[name] = converted;
      }
    }
    if (Object.keys(properties).length > 0) {
      result.properties = properties;
    }
  }

  if (schema.items) {
    const items = toGeminiSchema(schema.items);
    if (items) {
      result.items = items;
    }
  }

  // `enum` is only meaningful on a string in Gemini's subset; anywhere else it
  // is the kind of stray keyword that earns a 400.
  if (result.enum && result.type !== 'STRING') {
    delete result.enum;
  }

  // Gemini validates `required` against declared properties and rejects a name
  // that isn't one of them.
  if (Array.isArray(result.required)) {
    const declared = new Set(Object.keys(result.properties ?? {}));
    const kept = result.required.filter((name: any) => declared.has(name));
    if (kept.length > 0) {
      result.required = kept;
    } else {
      delete result.required;
    }
  }

  return result;
};

/**
 * A tool's `parameters`, or `undefined` for a no-argument tool.
 *
 * `get_voices` declares `{type: 'object', properties: {}}`, which Gemini
 * rejects as an OBJECT with no fields. Omitting `parameters` entirely is how
 * that tool is spelled here.
 */
export const toGeminiParameters = (schema: any): any => {
  const converted = toGeminiSchema(schema);
  if (!converted || Object.keys(converted.properties ?? {}).length === 0) {
    return undefined;
  }
  return converted;
};
