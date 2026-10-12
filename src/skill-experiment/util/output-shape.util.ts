import { stripMarkdownFences } from 'src/learn/util/autofill-shared.util';
import { SkillOutputShape } from '../type/skill-experiment.type';

/** Share of outputs that must be JSON objects before the skill is treated as JSON. */
const JSON_SHAPE_THRESHOLD = 0.8;

/**
 * Parse an output as a JSON object the way call sites do: fences stripped, then
 * the outermost `{ … }`. Null for anything that is not a plain object.
 */
export function parseJsonObjectOutput(
  output: string | null | undefined,
): Record<string, unknown> | null {
  if (!output) return null;
  const cleaned = stripMarkdownFences(output).trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * What the original's outputs look like, learnt from the baseline rather than
 * declared per skill: if nearly all are JSON objects, a challenger's must be too
 * and must carry every top-level key they all shared — that is the part a call
 * site's parser depends on. Otherwise the only requirement is a non-empty reply.
 */
export function inferOutputShape(outputs: string[]): SkillOutputShape {
  if (!outputs.length) return { kind: 'text' };
  const parsed = outputs.map(parseJsonObjectOutput);
  const objects = parsed.filter(
    (value): value is Record<string, unknown> => value !== null,
  );
  if (objects.length / outputs.length < JSON_SHAPE_THRESHOLD) {
    return { kind: 'text' };
  }
  const [first, ...rest] = objects.map((o) => new Set(Object.keys(o)));
  const requiredKeys = [...first]
    .filter((key) => rest.every((keys) => keys.has(key)))
    .sort();
  return { kind: 'json', requiredKeys };
}

/** Whether one output keeps the established shape. No shape yet → anything non-empty passes. */
export function conformsToShape(
  output: string | null | undefined,
  shape: SkillOutputShape | null | undefined,
): boolean {
  if (!output || !output.trim()) return false;
  if (!shape || shape.kind === 'text') return true;
  const parsed = parseJsonObjectOutput(output);
  if (!parsed) return false;
  return shape.requiredKeys.every((key) => key in parsed);
}
