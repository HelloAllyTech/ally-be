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
 *
 * ## Why near-miss key names are recovered, not dropped
 *
 * The first version of this file read structured rows by their declared key
 * and nothing else, so a repo plan written as `{ repoName, changes }` was
 * stored as `{ repo: '', changesMd: '' }` — the patch reported success and the
 * words vanished. With no way to read the stored document back mid-turn, the
 * agent could only see the blocker count refuse to move, and it burned a whole
 * session guessing at field names that were never the problem. Recovering the
 * synonym costs nothing and removes the failure entirely; what cannot be
 * recovered is reported through `PrdNormaliseDiagnostics` so the agent is told
 * rather than left to infer.
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

/** A value the agent wrote under a synonym and which was kept anyway. */
export interface PrdRecoveredKey {
  /** JSON Pointer to the row, e.g. "/technicalPlan/repos/0". */
  path: string;
  /** The key the agent wrote. */
  wrote: string;
  /** The declared field it was stored under. */
  storedAs: string;
}

/** Keys carrying content that no declared field on the row could claim. */
export interface PrdIgnoredKeys {
  path: string;
  keys: string[];
}

/**
 * What normalisation had to do to the agent's shapes.
 *
 * Fed back through the `update_prd` tool result. Both halves matter: a
 * recovered key tells the agent the name it should be using, and an ignored
 * key is the only warning it will get that words it wrote are not in the
 * document.
 */
export interface PrdNormaliseDiagnostics {
  recovered: PrdRecoveredKey[];
  ignored: PrdIgnoredKeys[];
}

export function createPrdNormaliseDiagnostics(): PrdNormaliseDiagnostics {
  return { recovered: [], ignored: [] };
}

/** Case and separators carry no meaning: `changes_md` === `changesMD`. */
function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reads one structured row's declared fields, trying synonyms in order.
 *
 * Tracks which of the row's own keys were consumed so whatever is left can be
 * reported as ignored — the row's unknown keys, unlike the document's, really
 * are dropped, because the three downstream readers only render the declared
 * ones.
 */
function rowReader(
  raw: Record<string, unknown>,
  path: string,
  diagnostics?: PrdNormaliseDiagnostics,
) {
  // Built once per row: canonical name → the actual key(s) the agent wrote.
  const byCanonical = new Map<string, string[]>();
  for (const key of Object.keys(raw)) {
    const canonical = canonicalKey(key);
    const existing = byCanonical.get(canonical);
    if (existing) {
      existing.push(key);
    } else {
      byCanonical.set(canonical, [key]);
    }
  }
  const claimed = new Set<string>();

  /**
   * First candidate that actually carries something. Emptiness is what makes
   * a candidate skippable: an agent that writes both `repo: ''` and
   * `repoName: 'ally-be'` meant the second one.
   */
  const pick = (
    declared: string,
    aliases: string[],
    hasContent: (value: unknown) => boolean,
  ): unknown => {
    for (const candidate of [declared, ...aliases]) {
      for (const key of byCanonical.get(canonicalKey(candidate)) ?? []) {
        if (claimed.has(key) || !hasContent(raw[key])) continue;
        claimed.add(key);
        if (diagnostics && canonicalKey(key) !== canonicalKey(declared)) {
          diagnostics.recovered.push({ path, wrote: key, storedAs: declared });
        }
        return raw[key];
      }
    }
    // Nothing carried content. Claim the declared key anyway when it exists,
    // so an intentionally-empty field is not reported as ignored.
    for (const key of byCanonical.get(canonicalKey(declared)) ?? []) {
      claimed.add(key);
    }
    return undefined;
  };

  return {
    text: (declared: string, aliases: string[] = []): string =>
      asPrdText(
        pick(declared, aliases, (value) => asPrdText(value).trim().length > 0),
      ),

    list: (declared: string, aliases: string[] = []): string[] =>
      asPrdTextList(
        pick(declared, aliases, (value) => asPrdTextList(value).length > 0),
      ),

    /** Unclaimed keys whose value carries words worth telling the agent about. */
    reportIgnored: (): void => {
      if (!diagnostics) return;
      // Words already stored under some other key are not lost, so they are
      // not worth a warning. This is also what keeps the synthesised row for a
      // bare-string entry quiet: `asList` writes the same string to several
      // keys, and only one of them gets claimed.
      const kept = new Set(
        [...claimed].map((key) => asPrdText(raw[key]).trim()),
      );
      const keys = Object.keys(raw).filter((key) => {
        if (claimed.has(key)) return false;
        const text = asPrdText(raw[key]).trim();
        return text.length > 0 && !kept.has(text);
      });
      if (keys.length) {
        diagnostics.ignored.push({ path, keys });
      }
    },
  };
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
  path: string,
  diagnostics?: PrdNormaliseDiagnostics,
): BuilderPrdRequirement {
  const row = rowReader(raw, path, diagnostics);
  const requirement: BuilderPrdRequirement = {
    id: row.text('id', ['key', 'ref']),
    title: row.text('title', ['name', 'label', 'summary', 'heading']),
    description: row.text('description', ['text', 'detail', 'details', 'body']),
    acceptanceCriteria: row.list('acceptanceCriteria', [
      'criteria',
      'acceptance',
      'acceptanceTests',
      'tests',
    ]),
  };
  row.reportIgnored();
  return requirement;
}

function normaliseAssumption(
  raw: Record<string, unknown>,
  path: string,
  diagnostics?: PrdNormaliseDiagnostics,
): BuilderPrdAssumption {
  const row = rowReader(raw, path, diagnostics);
  const assumption: BuilderPrdAssumption = {
    id: row.text('id', ['key', 'ref']),
    text: row.text('text', ['assumption', 'label', 'description', 'title']),
    // Anything the agent invents that is not the confirmed sentinel counts as
    // unconfirmed: an assumption whose status cannot be read is exactly the
    // one a human should still be looking at. `confirmed: true` is read as the
    // sentinel because it says the same thing in the shape the model reached
    // for, and treating it as unreadable would block readiness on an
    // assumption the admin had already settled.
    status:
      row.text('status', ['state', 'confirmed']).trim().toLowerCase() ===
        'confirmed' || raw.confirmed === true
        ? 'confirmed'
        : 'unconfirmed',
  };
  row.reportIgnored();
  return assumption;
}

function normaliseRepoPlan(
  raw: Record<string, unknown>,
  path: string,
  diagnostics?: PrdNormaliseDiagnostics,
): BuilderPrdRepoPlan {
  const row = rowReader(raw, path, diagnostics);
  const plan: BuilderPrdRepoPlan = {
    repo: row.text('repo', [
      'repoName',
      'repository',
      'targetRepo',
      'primaryRepo',
      'repos',
      'name',
    ]),
    changesMd: row.text('changesMd', [
      'changes',
      'changesMarkdown',
      'plan',
      'details',
      'description',
      'body',
      'text',
    ]),
  };
  row.reportIgnored();
  return plan;
}

/**
 * Coerce every declared field to its declared shape.
 *
 * Unknown top-level keys are carried through untouched. The agent occasionally
 * parks a note under a key of its own invention, and this is a shape guard,
 * not a schema police — dropping data the agent thought worth writing would be
 * a worse failure than the one being fixed.
 *
 * Pass `diagnostics` to collect what the coercion had to do; the interview's
 * `update_prd` tool hands that straight back to the model.
 */
export function normalisePrdDocument(
  draft: unknown,
  diagnostics?: PrdNormaliseDiagnostics,
): BuilderPrdDocument {
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
    requirements: asList(raw.requirements).map((entry, index) =>
      normaliseRequirement(entry, `/requirements/${index}`, diagnostics),
    ),
    assumptions: asList(raw.assumptions).map((entry, index) =>
      normaliseAssumption(entry, `/assumptions/${index}`, diagnostics),
    ),
    technicalPlan: {
      repos: asList(technicalPlan.repos).map((entry, index) =>
        normaliseRepoPlan(entry, `/technicalPlan/repos/${index}`, diagnostics),
      ),
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
