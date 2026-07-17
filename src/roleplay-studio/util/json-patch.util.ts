/**
 * Minimal hand-written RFC-6902 subset (add / replace / remove) used by the
 * copilot's update_spec tool. No dependency on fast-json-patch etc. — the
 * subset is small and we want structured, model-repairable errors.
 *
 * Semantics follow RFC 6902 + RFC 6901:
 *  - paths are JSON Pointers ("" = whole document, "/a/b/0", "~0" → "~",
 *    "~1" → "/");
 *  - `add` inserts into arrays (index or "-" to append) and sets/overwrites
 *    object members;
 *  - `replace` requires the target to exist;
 *  - `remove` requires the target to exist and splices arrays.
 *
 * The input document is never mutated — a deep clone is patched and returned.
 * Failures throw JsonPatchError with the failing op index so the caller can
 * hand the model a precise self-repair message.
 */

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: any;
}

export class JsonPatchError extends Error {
  constructor(
    message: string,
    public readonly opIndex?: number,
    public readonly op?: JsonPatchOp,
  ) {
    super(message);
    this.name = 'JsonPatchError';
  }
}

/** RFC 6901 pointer → decoded segments. */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new JsonPatchError(
      `Invalid JSON pointer "${pointer}": must be "" or start with "/"`,
    );
  }
  return pointer
    .substring(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function applyJsonPatch<T>(document: T, ops: JsonPatchOp[]): T {
  if (!Array.isArray(ops)) {
    throw new JsonPatchError('Patch must be an array of operations');
  }
  // jsonb documents are JSON-safe by construction, so a JSON round-trip is a
  // faithful deep clone (structuredClone types are unavailable at es2020 lib).
  let result: any =
    document === undefined ? undefined : JSON.parse(JSON.stringify(document));

  ops.forEach((op, index) => {
    try {
      result = applyOne(result, op);
    } catch (error) {
      if (error instanceof JsonPatchError && error.opIndex === undefined) {
        throw new JsonPatchError(error.message, index, op);
      }
      throw error;
    }
  });
  return result as T;
}

function applyOne(document: any, op: JsonPatchOp): any {
  if (!op || typeof op !== 'object') {
    throw new JsonPatchError('Operation must be an object');
  }
  if (!['add', 'replace', 'remove'].includes(op.op)) {
    throw new JsonPatchError(
      `Unsupported op "${String(op.op)}" (only add/replace/remove)`,
    );
  }
  if (typeof op.path !== 'string') {
    throw new JsonPatchError('Operation path must be a string');
  }
  if ((op.op === 'add' || op.op === 'replace') && !('value' in op)) {
    throw new JsonPatchError(`"${op.op}" requires a value`);
  }

  const segments = parseJsonPointer(op.path);

  // Whole-document target.
  if (segments.length === 0) {
    if (op.op === 'remove') {
      throw new JsonPatchError('Cannot remove the whole document');
    }
    return deepClone(op.value);
  }

  const parent = resolveParent(document, segments);
  const key = segments[segments.length - 1];

  if (Array.isArray(parent)) {
    applyToArray(parent, key, op);
  } else if (parent !== null && typeof parent === 'object') {
    applyToObject(parent, key, op);
  } else {
    throw new JsonPatchError(
      `Path "${op.path}" traverses a non-container value`,
    );
  }
  return document;
}

function resolveParent(document: any, segments: string[]): any {
  let current = document;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment, current.length, false);
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      if (!(segment in current)) {
        throw new JsonPatchError(
          `Path segment "${segment}" does not exist (at "/${segments
            .slice(0, i + 1)
            .join('/')}")`,
        );
      }
      current = current[segment];
    } else {
      throw new JsonPatchError(
        `Path segment "${segment}" traverses a non-container value`,
      );
    }
  }
  return current;
}

function applyToArray(parent: any[], key: string, op: JsonPatchOp): void {
  if (op.op === 'add') {
    if (key === '-') {
      parent.push(deepClone(op.value));
      return;
    }
    const index = parseArrayIndex(key, parent.length, true);
    parent.splice(index, 0, deepClone(op.value));
    return;
  }
  const index = parseArrayIndex(key, parent.length, false);
  if (op.op === 'replace') {
    parent[index] = deepClone(op.value);
  } else {
    parent.splice(index, 1);
  }
}

function applyToObject(
  parent: Record<string, any>,
  key: string,
  op: JsonPatchOp,
): void {
  if (op.op === 'add') {
    parent[key] = deepClone(op.value);
    return;
  }
  if (!(key in parent)) {
    throw new JsonPatchError(`Cannot ${op.op} non-existent member "${key}"`);
  }
  if (op.op === 'replace') {
    parent[key] = deepClone(op.value);
  } else {
    delete parent[key];
  }
}

/** `allowEnd` permits index === length (insertion point for add). */
function parseArrayIndex(
  segment: string,
  length: number,
  allowEnd: boolean,
): number {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    throw new JsonPatchError(`Invalid array index "${segment}"`);
  }
  const index = Number(segment);
  const max = allowEnd ? length : length - 1;
  if (index > max) {
    throw new JsonPatchError(
      `Array index ${index} out of bounds (length ${length})`,
    );
  }
  return index;
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
