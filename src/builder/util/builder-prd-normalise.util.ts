import {
  BuilderPrdAssumption,
  BuilderPrdDocument,
  BuilderPrdRepoPlan,
  BuilderPrdRequirement,
  createEmptyPrdDocument,
} from '../type/builder-prd.type';

/**
 * Bring an agent-written PRD back to its declared shape.
 *
 * `update_prd` takes RFC-6902 operations with an untyped `value`, which is
 * what makes it useful — the agent patches one pointer as it learns one thing,
 * without restating the document. Nothing in that path checks that the value
 * matches the field, so the model can and does write structure where the
 * schema says string: `openQuestions` as `{ id, text }` rows rather than
 * sentences is the shape that reached the admin console and crashed the PRD
 * panel, taking the interview transcript beside it down too.
 *
 * Normalising here rather than rejecting the patch is deliberate. A rejected
 * op costs the agent a self-repair turn and loses whatever it had just worked
 * out; the words it wrote are right, only the container is wrong. The three
 * downstream readers — the panel, the readiness rubric, and the build prompt
 * that renders the PRD into text for the coding agent — all want a string, and
 * this is the one place that can promise them one.
 */

/** Keys checked, in order, when an object turns up where text belongs. */
const TEXT_KEYS = [
  'text',
  'label',
  'title',
  'question',
  'prompt',
  'description',
  'name',
  'summary',
  'value',
];

/** Anything at all → a string. Never returns an object. */
export function asPrdText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // An array where one string belongs: read it as lines rather than keeping
  // only the first, which is how a model writes a multi-part answer.
  if (Array.isArray(value)) {
    return value.map(asPrdText).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
    // An object with nothing in it says nothing — rendering "{}" would put a
    // bullet in a list for a row the agent had not written yet.
    if (Object.keys(record).length === 0) return '';
    // Otherwise deliberately visible rather than dropped: an unreadable field
    // should look wrong to whoever is watching the document fill in.
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Anything at all → a list of strings.
 *
 * A bare string where an array belongs becomes a one-item list rather than
 * `[]`: the agent wrote one open question instead of a list of them, and
 * dropping it would silently clear a readiness blocker.
 */
export function asPrdTextList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map(asPrdText).filter((entry) => entry.trim().length > 0);
  }
  const single = asPrdText(value);
  return single.trim() ? [single] : [];
}

function asList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : // A bare string where a structured row belongs — keep the words and
        // let the field coercion below put them somewhere readable.
        { text: entry, title: entry, changesMd: entry },
  );
}

function normaliseRequirement(
  raw: Record<string, unknown>,
): BuilderPrdRequirement {
  return {
    id: asPrdText(raw.id),
    title: asPrdText(raw.title),
    description: asPrdText(raw.description),
    acceptanceCriteria: asPrdTextList(raw.acceptanceCriteria),
  };
}

function normaliseAssumption(
  raw: Record<string, unknown>,
): BuilderPrdAssumption {
  return {
    id: asPrdText(raw.id),
    text: asPrdText(raw.text),
    // Anything the agent invents that is not the confirmed sentinel counts as
    // unconfirmed: an assumption whose status cannot be read is exactly the
    // one a human should still be looking at.
    status: raw.status === 'confirmed' ? 'confirmed' : 'unconfirmed',
  };
}

function normaliseRepoPlan(raw: Record<string, unknown>): BuilderPrdRepoPlan {
  return { repo: asPrdText(raw.repo), changesMd: asPrdText(raw.changesMd) };
}

/**
 * Coerce every declared field to its declared shape.
 *
 * Unknown top-level keys are carried through untouched. The agent occasionally
 * parks a note under a key of its own invention, and this is a shape guard,
 * not a schema police — dropping data the agent thought worth writing would be
 * a worse failure than the one being fixed.
 */
export function normalisePrdDocument(draft: unknown): BuilderPrdDocument {
  const raw: Record<string, unknown> =
    draft !== null && typeof draft === 'object' && !Array.isArray(draft)
      ? (draft as Record<string, unknown>)
      : {};
  const empty = createEmptyPrdDocument();
  const technicalPlan =
    raw.technicalPlan !== null && typeof raw.technicalPlan === 'object'
      ? (raw.technicalPlan as Record<string, unknown>)
      : {};

  return {
    ...raw,
    title: asPrdText(raw.title ?? empty.title),
    summary: asPrdText(raw.summary),
    problem: asPrdText(raw.problem),
    usersAndContext: asPrdText(raw.usersAndContext),
    goals: asPrdText(raw.goals),
    nonGoals: asPrdText(raw.nonGoals),
    requirements: asList(raw.requirements).map(normaliseRequirement),
    assumptions: asList(raw.assumptions).map(normaliseAssumption),
    technicalPlan: {
      repos: asList(technicalPlan.repos).map(normaliseRepoPlan),
      dataModelMd: asPrdText(technicalPlan.dataModelMd),
      apiMd: asPrdText(technicalPlan.apiMd),
    },
    testPlanMd: asPrdText(raw.testPlanMd),
    e2ePlanMd: asPrdText(raw.e2ePlanMd),
    openQuestions: asPrdTextList(raw.openQuestions),
    // Progress flags, not prose — pass through when it is an object at all.
    ui:
      raw.ui !== null && typeof raw.ui === 'object' && !Array.isArray(raw.ui)
        ? (raw.ui as BuilderPrdDocument['ui'])
        : empty.ui,
  };
}
