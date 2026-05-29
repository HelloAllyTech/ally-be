import {
  AvailableVariable,
  AvailableVariableEntry,
} from '../entity/prompt.entity';

/**
 * Read just the placeholder name from a variable entry. Used by callers
 * that only need to know which placeholders exist (e.g. runtime
 * allowed-variable gating), regardless of whether the row was stored under
 * the legacy `string[]` schema or the richer object schema.
 */
export function getAvailableVariableName(
  entry: AvailableVariableEntry,
): string {
  if (typeof entry === 'string') return entry;
  return entry?.name ?? '';
}

/**
 * Convert a mixed entry list into the canonical object form
 * `{ name, label?, required? }`. Plain strings become `{ name }`; objects
 * pass through with their metadata preserved. Empty / malformed entries
 * are dropped.
 */
export function normalizeAvailableVariables(
  entries: AvailableVariableEntry[] | undefined | null,
): AvailableVariable[] {
  if (!Array.isArray(entries)) return [];
  const byName = new Map<string, AvailableVariable>();
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (name && !byName.has(name)) {
        byName.set(name, { name });
      }
    } else if (entry && typeof entry === 'object') {
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) continue;
      const existing = byName.get(name);
      // First write wins for metadata so a later auto-parsed string
      // doesn't clobber a meta JSON's label / required.
      byName.set(name, {
        name,
        label: existing?.label ?? entry.label,
        required: existing?.required ?? entry.required,
      });
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Recompute the canonical variable list against the placeholders actually
 * referenced by the current prompt text.
 *
 * - Placeholders present in the new text AND in the existing metadata:
 *   kept, with their label / required preserved.
 * - Placeholders present in the new text but not in the existing metadata:
 *   appended as bare `{ name }` (no label, not required).
 * - Placeholders in the existing metadata but no longer in the new text:
 *   dropped from `availableVariables` (the studio stops surfacing them).
 *
 * Simulation-side values are NOT touched here — when a prompt drops a
 * placeholder, the simulation's previously-saved value for that field
 * stays in `customFields` / metadata and is simply not rendered or
 * substituted until the placeholder reappears. That's the "graceful
 * unmapping" behavior called out in the plan.
 */
export function reconcileAvailableVariables(
  existing: AvailableVariableEntry[] | undefined | null,
  parsedNames: string[],
): AvailableVariable[] {
  const existingByName = new Map<string, AvailableVariable>();
  for (const entry of normalizeAvailableVariables(existing)) {
    existingByName.set(entry.name, entry);
  }

  const result: AvailableVariable[] = [];
  for (const name of parsedNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const preserved = existingByName.get(trimmed);
    if (preserved) {
      result.push(preserved);
    } else {
      result.push({ name: trimmed });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
