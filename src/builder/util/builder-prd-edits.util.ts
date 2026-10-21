import {
  applyJsonPatch,
  JsonPatchError,
  JsonPatchOp,
  parseJsonPointer,
} from 'src/common/util/json-patch.util';
import {
  BUILDER_REPO_NAMES,
  isBuilderRepo,
} from '../constants/builder-repos.constants';
import {
  BuilderPrdAssumption,
  BuilderPrdDocument,
  BuilderPrdRequirement,
} from '../type/builder-prd.type';
import { asPrdText, asPrdTextList } from './builder-prd-normalise.util';

/**
 * PRD edits addressed by what an entry IS rather than where it sits.
 *
 * `update_prd` addresses the document by JSON Pointer, so a requirement is
 * `/requirements/2` — its position, not its name. Positions move: in session
 * 2bc3a5cf the last edit of the interview removed one requirement and then
 * patched "the next one" by its old index, the patch failed, and the reply
 * said the PRD was revised. These edits name the entry instead (requirement
 * `R3`, the `ally-mobile` repo plan, assumption `A2`), and they are resolved
 * against the draft inside the write transaction, so nothing can move between
 * the agent reading the document and the edit landing.
 *
 * The stored shape is unchanged — the design and build halves read the same
 * document they always did.
 */

/** Prose sections an edit can set, by the key the agent names them with. */
export const PRD_SECTION_KEYS = [
  'title',
  'summary',
  'problem',
  'usersAndContext',
  'existingBehaviour',
  'whereChangesBelong',
  'goals',
  'nonGoals',
  'testPlanMd',
  'e2ePlanMd',
  'dataModelMd',
  'apiMd',
] as const;

export type PrdSectionKey = (typeof PRD_SECTION_KEYS)[number];

/** What the admin calls each section — the labels the PRD panel and the receipt use. */
export const PRD_SECTION_LABELS: Record<PrdSectionKey, string> = {
  title: 'Title',
  summary: 'Summary',
  problem: 'Problem',
  usersAndContext: 'Users & context',
  existingBehaviour: 'What already exists',
  whereChangesBelong: 'Where the change belongs',
  goals: 'Goals',
  nonGoals: 'Non-goals',
  testPlanMd: 'Test plan',
  e2ePlanMd: 'E2E test plan',
  dataModelMd: 'Data model notes',
  apiMd: 'API notes',
};

/** The two prose sections that live inside the technical plan. */
const TECHNICAL_PLAN_SECTIONS = new Set<PrdSectionKey>([
  'dataModelMd',
  'apiMd',
]);

export type PrdEdit =
  | {
      kind: 'set_section';
      section: string;
      text: unknown;
      /** `append` adds the text as a new line after what is there. */
      mode?: 'replace' | 'append';
    }
  | {
      kind: 'upsert_requirement';
      id: string;
      title?: unknown;
      description?: unknown;
      acceptanceCriteria?: unknown;
    }
  | { kind: 'remove_requirement'; id: string }
  | { kind: 'set_repo_plan'; repo: string; changesMd: unknown }
  | { kind: 'remove_repo_plan'; repo: string }
  | {
      kind: 'upsert_assumption';
      id: string;
      text?: unknown;
      status?: unknown;
      evidence?: unknown;
    }
  | { kind: 'set_open_questions'; questions: unknown };

/** An edit that cannot apply, with a message written for the agent to act on. */
export class PrdEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrdEditError';
  }
}

const sameId = (a: unknown, b: unknown): boolean =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

const idsIn = (rows: { id?: string }[]): string =>
  rows
    .map((row) => String(row.id ?? '').trim())
    .filter(Boolean)
    .join(', ') || 'none';

const plannedRepos = (draft: BuilderPrdDocument): string =>
  (draft.technicalPlan?.repos ?? [])
    .map((plan) => String(plan.repo ?? '').trim())
    .filter(Boolean)
    .join(', ') || 'none';

function requireId(raw: unknown, what: string): string {
  const id = String(raw ?? '').trim();
  if (!id) {
    throw new PrdEditError(
      `${what} needs an id — the short stable handle the plan and the PR bodies cite ("R1", "A2").`,
    );
  }
  return id;
}

function requireRepo(raw: unknown): string {
  const repo = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!isBuilderRepo(repo)) {
    throw new PrdEditError(
      `"${repo}" is not a repo Builder can work in. Use one of: ${BUILDER_REPO_NAMES.join(', ')}.`,
    );
  }
  return repo;
}

/**
 * Apply one id-addressed edit to a draft. Pure: the draft is cloned, never
 * mutated, and an edit that cannot apply throws `PrdEditError` naming what is
 * there instead — the same self-repair contract `update_prd` has.
 */
export function applyPrdEdit(
  draft: BuilderPrdDocument,
  edit: PrdEdit,
): BuilderPrdDocument {
  const next: BuilderPrdDocument = JSON.parse(JSON.stringify(draft));
  next.requirements = Array.isArray(next.requirements) ? next.requirements : [];
  next.assumptions = Array.isArray(next.assumptions) ? next.assumptions : [];
  const plan: Partial<BuilderPrdDocument['technicalPlan']> =
    next.technicalPlan ?? {};
  next.technicalPlan = {
    ...plan,
    repos: Array.isArray(plan.repos) ? plan.repos : [],
    dataModelMd: plan.dataModelMd ?? '',
    apiMd: plan.apiMd ?? '',
  };

  switch (edit.kind) {
    case 'set_section': {
      const section = String(edit.section ?? '').trim() as PrdSectionKey;
      if (!(PRD_SECTION_KEYS as readonly string[]).includes(section)) {
        throw new PrdEditError(
          `"${edit.section}" is not a section set_section can write. Sections: ` +
            `${PRD_SECTION_KEYS.join(', ')}. Requirements, assumptions, repo plans and ` +
            'open questions have their own tools.',
        );
      }
      const holder: Record<string, any> = TECHNICAL_PLAN_SECTIONS.has(section)
        ? next.technicalPlan
        : next;
      const text = asPrdText(edit.text);
      const current = String(holder[section] ?? '');
      holder[section] =
        edit.mode === 'append' && current.trim()
          ? `${current.replace(/\s+$/, '')}\n${text}`
          : text;
      return next;
    }

    case 'upsert_requirement': {
      const id = requireId(edit.id, 'A requirement');
      const index = next.requirements.findIndex((row) => sameId(row.id, id));
      const existing: BuilderPrdRequirement =
        index >= 0
          ? next.requirements[index]
          : { id, title: '', description: '', acceptanceCriteria: [] };
      const merged: BuilderPrdRequirement = {
        ...existing,
        id: existing.id || id,
        ...(edit.title !== undefined ? { title: asPrdText(edit.title) } : {}),
        ...(edit.description !== undefined
          ? { description: asPrdText(edit.description) }
          : {}),
        ...(edit.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: asPrdTextList(edit.acceptanceCriteria) }
          : {}),
      };
      if (index >= 0) {
        next.requirements[index] = merged;
      } else {
        if (!merged.title.trim() && !merged.description.trim()) {
          throw new PrdEditError(
            `There is no requirement ${id} yet (ids: ${idsIn(next.requirements)}), and a new ` +
              'one needs a title or a description.',
          );
        }
        next.requirements.push(merged);
      }
      return next;
    }

    case 'remove_requirement': {
      const id = requireId(edit.id, 'Removing a requirement');
      const index = next.requirements.findIndex((row) => sameId(row.id, id));
      if (index < 0) {
        throw new PrdEditError(
          `There is no requirement ${id} to remove (ids: ${idsIn(next.requirements)}).`,
        );
      }
      next.requirements.splice(index, 1);
      return next;
    }

    case 'set_repo_plan': {
      const repo = requireRepo(edit.repo);
      const changesMd = asPrdText(edit.changesMd);
      if (!changesMd.trim()) {
        throw new PrdEditError(
          `Say what changes in ${repo} — changesMd is empty. To drop the repo from the plan, ` +
            'use remove_repo_plan.',
        );
      }
      const index = next.technicalPlan.repos.findIndex((plan) =>
        sameId(plan.repo, repo),
      );
      if (index >= 0) {
        next.technicalPlan.repos[index] = { repo, changesMd };
      } else {
        next.technicalPlan.repos.push({ repo, changesMd });
      }
      return next;
    }

    case 'remove_repo_plan': {
      const repo = String(edit.repo ?? '').trim();
      const index = next.technicalPlan.repos.findIndex((plan) =>
        sameId(plan.repo, repo),
      );
      if (index < 0) {
        throw new PrdEditError(
          `${repo || 'That repo'} is not in the technical plan (planned: ${plannedRepos(next)}).`,
        );
      }
      next.technicalPlan.repos.splice(index, 1);
      return next;
    }

    case 'upsert_assumption': {
      const id = requireId(edit.id, 'An assumption');
      const index = next.assumptions.findIndex((row) => sameId(row.id, id));
      const existing: BuilderPrdAssumption =
        index >= 0
          ? next.assumptions[index]
          : { id, text: '', status: 'unconfirmed' };
      const status =
        edit.status === undefined
          ? existing.status
          : String(edit.status).trim().toLowerCase() === 'confirmed'
            ? 'confirmed'
            : 'unconfirmed';
      // Evidence is passed through as written; normalisation on write keeps
      // only a complete {source, detail} and stamps `at`.
      const merged = {
        ...existing,
        id: existing.id || id,
        ...(edit.text !== undefined ? { text: asPrdText(edit.text) } : {}),
        status,
        ...(edit.evidence !== undefined ? { evidence: edit.evidence } : {}),
      } as BuilderPrdAssumption;
      if (index >= 0) {
        next.assumptions[index] = merged;
      } else {
        if (!merged.text.trim()) {
          throw new PrdEditError(
            `There is no assumption ${id} yet (ids: ${idsIn(next.assumptions)}), and a new one ` +
              'needs its text.',
          );
        }
        next.assumptions.push(merged);
      }
      return next;
    }

    case 'set_open_questions': {
      next.openQuestions = asPrdTextList(edit.questions);
      return next;
    }

    default:
      throw new PrdEditError(
        `Unknown PRD edit "${(edit as { kind?: string })?.kind}".`,
      );
  }
}

/** Arrays whose rows can be addressed by id (or repo name) in a pointer. */
const KEYED_ARRAYS: { prefix: string[]; key: 'id' | 'repo'; what: string }[] = [
  { prefix: ['requirements'], key: 'id', what: 'requirement' },
  { prefix: ['assumptions'], key: 'id', what: 'assumption' },
  { prefix: ['technicalPlan', 'repos'], key: 'repo', what: 'repo plan' },
];

const encodeSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');

const isIndex = (segment: string): boolean =>
  segment === '-' || /^(0|[1-9]\d*)$/.test(segment);

/**
 * One `update_prd` op made tolerant of how the agent actually addresses things.
 *
 * - An id or repo name works where an index would: `/requirements/R3/title`,
 *   `/technicalPlan/repos/ally-be/changesMd`. Resolved against the draft as it
 *   stands when this op runs, so an earlier op in the same patch that removed
 *   a row cannot shift it.
 * - `add`/`replace` of a whole row by an id that is not there yet appends it
 *   (with that id), and `add` of a row by an id that IS there replaces it — by
 *   name, "add R3" can only mean one thing.
 * - `add /<text field>/-` appends a line to prose, which is what an agent
 *   writing "/goals/-" means; strictly it addresses an array that is not there.
 *
 * Returns the op to apply as-is when none of that applies.
 */
function tolerantOp(current: any, op: JsonPatchOp): JsonPatchOp {
  const segments = parseJsonPointer(String(op?.path ?? ''));

  for (const keyed of KEYED_ARRAYS) {
    const depth = keyed.prefix.length;
    if (
      segments.length <= depth ||
      !keyed.prefix.every((segment, index) => segments[index] === segment) ||
      isIndex(segments[depth])
    ) {
      continue;
    }
    const rows: any[] = keyed.prefix.reduce(
      (value, segment) => (value == null ? value : value[segment]),
      current,
    );
    const list = Array.isArray(rows) ? rows : [];
    const handle = segments[depth];
    const index = list.findIndex((row) => sameId(row?.[keyed.key], handle));
    const wholeRow = segments.length === depth + 1;

    if (index < 0) {
      if (wholeRow && (op.op === 'add' || op.op === 'replace')) {
        const value =
          op.value && typeof op.value === 'object' && !Array.isArray(op.value)
            ? { [keyed.key]: handle, ...op.value }
            : op.value;
        return {
          op: 'add',
          path: `/${[...keyed.prefix, '-'].join('/')}`,
          value,
        };
      }
      const present = list
        .map((row) => String(row?.[keyed.key] ?? '').trim())
        .filter(Boolean);
      throw new JsonPatchError(
        `No ${keyed.what} "${handle}" — present: ${present.join(', ') || 'none'}.`,
        undefined,
        op,
      );
    }
    const resolved = [...segments];
    resolved[depth] = String(index);
    return {
      ...op,
      op: wholeRow && op.op === 'add' ? 'replace' : op.op,
      path: `/${resolved.map(encodeSegment).join('/')}`,
    };
  }

  if (op?.op === 'add' && segments[segments.length - 1] === '-') {
    const parentPath = segments.slice(0, -1);
    const parent = parentPath.reduce(
      (value: any, segment) => (value == null ? value : value[segment]),
      current,
    );
    if (typeof parent === 'string') {
      const line = asPrdText(op.value);
      return {
        op: 'replace',
        path: `/${parentPath.map(encodeSegment).join('/')}`,
        value: parent.trim() ? `${parent.replace(/\s+$/, '')}\n${line}` : line,
      };
    }
  }
  return op;
}

/**
 * `applyJsonPatch`, one op at a time through `tolerantOp`, keeping the failing
 * op's index on the error the way the strict version reports it.
 */
export function applyTolerantPrdPatch<T>(document: T, ops: JsonPatchOp[]): T {
  if (!Array.isArray(ops)) {
    throw new JsonPatchError('Patch must be an array of operations');
  }
  let result: T = document;
  ops.forEach((op, index) => {
    try {
      result = applyJsonPatch(result, [tolerantOp(result, op)]);
    } catch (error) {
      if (error instanceof JsonPatchError) {
        throw new JsonPatchError(error.message, index, op);
      }
      throw error;
    }
  });
  // An empty patch still returns a copy, as the strict version does.
  return ops.length ? result : applyJsonPatch(document, []);
}

/**
 * What an agent write would newly break in the document's structure: a
 * requirement with no id, or a repo plan entry with no repo Builder knows.
 *
 * Only what the write ADDS counts. A document that already holds such a row
 * (written before this check existed) must still be editable, or the agent
 * could never repair it.
 */
export function structuralRegressions(
  before: BuilderPrdDocument,
  after: BuilderPrdDocument,
): string[] {
  const withoutId = (draft: BuilderPrdDocument) =>
    (draft.requirements ?? []).filter((row) => !String(row?.id ?? '').trim())
      .length;
  const withoutRepo = (draft: BuilderPrdDocument) =>
    (draft.technicalPlan?.repos ?? []).filter(
      (plan) => !isBuilderRepo(String(plan?.repo ?? '').trim()),
    ).length;

  const problems: string[] = [];
  if (withoutId(after) > withoutId(before)) {
    problems.push(
      'Every requirement needs an id ("R1", "R2"…) — the plan, the milestones and the PR ' +
        'bodies cite requirements by it. Use upsert_requirement with an id.',
    );
  }
  if (withoutRepo(after) > withoutRepo(before)) {
    problems.push(
      `A technical plan entry needs a repo, one of: ${BUILDER_REPO_NAMES.join(', ')}. Use ` +
        'set_repo_plan with the repo name; if you do not know the repo yet, that is an open ' +
        'question, not a plan entry.',
    );
  }
  return problems;
}
