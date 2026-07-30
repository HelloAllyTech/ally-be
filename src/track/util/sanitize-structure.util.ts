/**
 * Postgres rejects NUL bytes and lone (unpaired) UTF-16 surrogates inside
 * text/jsonb columns. Both can slip into pasted rich text (Word/PDF/AI-generated
 * copy) and otherwise only surface as an opaque QueryFailedError at insert time,
 * long after class-validator has already accepted the payload.
 */
function stripInvalidChars(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[i] + value[i + 1];
        i++;
        continue;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    result += value[i];
  }
  return result;
}

/** Recursively strips invalid characters from every string in an arbitrary object/array tree. */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return stripInvalidChars(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = sanitizeDeep(val);
    }
    return out as T;
  }
  return value;
}
