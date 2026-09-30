import {
  EditableUpdateField,
  SUMMARY_MAX,
  TEAM_NOTES_MAX,
  TITLE_MAX,
  UPDATE_AREAS,
  UPDATE_AUDIENCES,
  UPDATE_KINDS,
  UPDATE_SURFACES,
  UpdateArea,
  UpdateAudience,
  UpdateKind,
  UpdateSurface,
} from '../constants/product-update.constants';

/**
 * The contract between the consolidation job and the model: how a batch is
 * written out for it, and how its answer is checked before anything is saved.
 *
 * Pure functions, so the part that decides what reaches the public page can be
 * tested without a model, a database or GitHub.
 */

/** One merged change as the model sees it. */
export interface ClusterSource {
  repo: string;
  prNumber: number | null;
  headRef: string | null;
  author: string | null;
  mergedAt: Date;
  subjects: string[];
  body: string | null;
  files: string[];
  staffOnlyHint: boolean;
}

export interface ClusterInput {
  id: string;
  sources: ClusterSource[];
}

export interface OpenUpdateInput {
  id: string;
  title: string;
  summary: string;
  kind: UpdateKind;
  audience: UpdateAudience;
  surfaces: UpdateSurface[];
  published: boolean;
  editedFields: EditableUpdateField[];
  sourceSubjects: string[];
}

export interface DraftUpdate {
  title: string;
  summary: string;
  teamNotes: string;
  kind: UpdateKind;
  audience: UpdateAudience;
  surfaces: UpdateSurface[];
  area: UpdateArea;
  confidence: number;
}

export type ConsolidationDecision =
  | { action: 'new'; clusterIds: string[]; update: DraftUpdate; reason: string }
  | {
      action: 'attach';
      clusterIds: string[];
      updateId: string;
      update: Partial<DraftUpdate>;
      reason: string;
    }
  | { action: 'noise'; clusterIds: string[]; reason: string };

const BODY_EXCERPT = 1200;
const MAX_FILE_GROUPS = 8;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function excerpt(text: string | null, max: number): string | null {
  if (!text) return null;
  const flat = collapse(
    text
      // Verification sections are long and say nothing about the product.
      .replace(
        /#+\s*(verification|testing|test plan)[\s\S]*?(?=\n#+\s|$)/gi,
        '',
      )
      .replace(/🤖 Generated with[^\n]*/g, '')
      .replace(/Co-Authored-By:[^\n]*/gi, ''),
  );
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Directory-level summary of a file list — "apps/ally-admin-dashboard/src/pages/Analytics (6)".
 * The model needs to know where a change landed, not every path.
 */
export function summariseFiles(files: readonly string[]): string {
  if (files.length === 0) return 'unknown';
  const groups = new Map<string, number>();
  const depthFor: Record<string, number> = { apps: 5, libs: 3, app: 3, src: 2 };
  for (const file of files) {
    const parts = file.split('/');
    const depth = depthFor[parts[0]] ?? 2;
    const key =
      parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || file;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const shown = sorted
    .slice(0, MAX_FILE_GROUPS)
    .map(([dir, count]) => `${dir} (${count})`);
  const rest = sorted.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
}

function describeSource(source: ClusterSource): string {
  const date = source.mergedAt.toISOString().slice(0, 10);
  const who = source.author ? ` by ${source.author}` : '';
  const lines: string[] = [];
  if (source.prNumber !== null) {
    lines.push(
      `- ${source.repo} pull request #${source.prNumber} "${source.subjects[0] ?? ''}"${who}, merged ${date}${
        source.headRef ? `, branch ${source.headRef}` : ''
      }`,
    );
  } else {
    lines.push(
      `- ${source.repo} direct push${who}, merged ${date}, ${source.subjects.length} commit(s):`,
    );
    for (const subject of source.subjects.slice(0, 12)) {
      lines.push(`  • ${subject}`);
    }
  }
  lines.push(`  Files: ${summariseFiles(source.files)}`);
  if (source.staffOnlyHint) lines.push('  Hint: staff-only files');
  const body = excerpt(source.body, BODY_EXCERPT);
  if (body) lines.push(`  Details: ${body}`);
  return lines.join('\n');
}

/** The user message for one consolidation call. */
export function buildConsolidationInput(
  clusters: readonly ClusterInput[],
  openUpdates: readonly OpenUpdateInput[],
): string {
  const parts: string[] = [];

  parts.push('OPEN UPDATES');
  if (openUpdates.length === 0) {
    parts.push('(none)');
  }
  for (const update of openUpdates) {
    parts.push(
      [
        `### Open update ${update.id}`,
        `Title: ${update.title}`,
        `Kind: ${update.kind} · Audience: ${update.audience} · Surfaces: ${update.surfaces.join(', ')}`,
        `Summary: ${update.summary}`,
        `Published: ${update.published ? 'yes' : 'not yet'}`,
        `Changes so far: ${update.sourceSubjects.slice(0, 8).join(' | ')}`,
        update.editedFields.length
          ? `Edited by a person (never return these): ${update.editedFields.join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  parts.push('', 'CLUSTERS');
  for (const cluster of clusters) {
    parts.push(
      `### Cluster ${cluster.id}\n${cluster.sources.map(describeSource).join('\n')}`,
    );
  }

  return parts.join('\n\n');
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function surfacesOf(value: unknown): UpdateSurface[] | null {
  if (!Array.isArray(value)) return null;
  const surfaces = [
    ...new Set(
      value.filter((item): item is UpdateSurface =>
        (UPDATE_SURFACES as readonly string[]).includes(item),
      ),
    ),
  ];
  return surfaces.length ? surfaces : null;
}

function confidenceOf(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number)
    ? Math.min(Math.max(number, 0), 1)
    : null;
}

/**
 * The fields of a draft the model got right, normalised; wrong ones dropped.
 * `requireAll` is for a new update, which cannot be saved half-written.
 */
function readDraft(
  raw: unknown,
  requireAll: boolean,
): Partial<DraftUpdate> | null {
  if (!raw || typeof raw !== 'object') return requireAll ? null : {};
  const record = raw as Record<string, unknown>;
  const draft: Partial<DraftUpdate> = {};

  const title = asString(record.title);
  if (title) draft.title = clip(title.replace(/\.$/, ''), TITLE_MAX);
  const summary = asString(record.summary);
  if (summary) draft.summary = clip(summary, SUMMARY_MAX);
  const teamNotes = asString(record.teamNotes);
  if (teamNotes) draft.teamNotes = clip(teamNotes, TEAM_NOTES_MAX);
  const kind = oneOf(record.kind, UPDATE_KINDS);
  if (kind) draft.kind = kind;
  const audience = oneOf(record.audience, UPDATE_AUDIENCES);
  if (audience) draft.audience = audience;
  const surfaces = surfacesOf(record.surfaces);
  if (surfaces) draft.surfaces = surfaces;
  const area = oneOf(record.area, UPDATE_AREAS);
  if (area) draft.area = area;
  const confidence = confidenceOf(record.confidence);
  if (confidence !== null) draft.confidence = confidence;

  // Internal work lives in the admin console. The model tends to put the
  // area ("Staff tools") where a surface belongs, which would otherwise leave a
  // perfectly good internal update with no surface and throw it away.
  if (
    !draft.surfaces &&
    (draft.audience === 'internal' || draft.area === 'Staff tools')
  ) {
    draft.surfaces = ['admin_console'];
  }

  if (!requireAll) return draft;
  if (!draft.title || !draft.summary || !draft.kind || !draft.surfaces) {
    return null;
  }
  const filled = {
    teamNotes: '',
    // A missing audience is the one gap filled conservatively: an update the
    // model did not say was public stays off the public page.
    audience: 'internal' as UpdateAudience,
    confidence: draft.audience ? 0.5 : 0.3,
    ...draft,
  };
  return {
    area: filled.audience === 'internal' ? 'Staff tools' : 'Reliability',
    ...filled,
  };
}

/** The JSON object in a model reply, tolerating a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('The model reply contained no JSON object.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export interface ParsedConsolidation {
  decisions: ConsolidationDecision[];
  /** Cluster ids the reply left out or used twice — retried next run, never guessed. */
  unresolvedClusterIds: string[];
  problems: string[];
}

/**
 * Checks a reply against the batch it answers.
 *
 * Nothing unverifiable is saved: a decision naming an unknown cluster or open
 * update, a new update missing its title/summary/kind/surfaces, or a cluster
 * claimed twice is dropped, and its clusters go back to the queue for the next
 * run. Being conservative here is cheap — a cluster left unconsolidated costs a
 * few hours' delay, an invented one costs a wrong line on a public page.
 */
export function parseConsolidationOutput(
  reply: string,
  clusterIds: readonly string[],
  openUpdateIds: readonly string[],
): ParsedConsolidation {
  const known = new Set(clusterIds);
  const openIds = new Set(openUpdateIds);
  const problems: string[] = [];
  const claimed = new Map<string, number>();

  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch (error) {
    return {
      decisions: [],
      unresolvedClusterIds: [...clusterIds],
      problems: [(error as Error).message],
    };
  }

  const rawDecisions = Array.isArray(
    (raw as { decisions?: unknown })?.decisions,
  )
    ? ((raw as { decisions: unknown[] }).decisions as unknown[])
    : [];
  if (rawDecisions.length === 0) problems.push('The reply had no decisions.');

  const accepted: ConsolidationDecision[] = [];
  for (const [index, item] of rawDecisions.entries()) {
    const record = (item ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(record.clusterIds)
      ? record.clusterIds.filter((id): id is string => typeof id === 'string')
      : [];
    const reason = asString(record.reason) ?? '';
    const action = oneOf(record.action, ['new', 'attach', 'noise'] as const);

    if (!ids.length || ids.some((id) => !known.has(id)) || !action) {
      problems.push(
        `Decision ${index} names unknown clusters or has no action.`,
      );
      continue;
    }

    let decision: ConsolidationDecision | null = null;
    if (action === 'noise') {
      decision = { action, clusterIds: ids, reason };
    } else if (action === 'new') {
      const update = readDraft(record.update, true) as DraftUpdate | null;
      if (update) decision = { action, clusterIds: ids, update, reason };
      else
        problems.push(
          `Decision ${index} is a new update missing required fields.`,
        );
    } else {
      const updateId = asString(record.updateId);
      if (updateId && openIds.has(updateId)) {
        decision = {
          action,
          clusterIds: ids,
          updateId,
          update: readDraft(record.update, false) ?? {},
          reason,
        };
      } else {
        problems.push(
          `Decision ${index} attaches to an update that is not open.`,
        );
      }
    }

    if (decision) {
      accepted.push(decision);
      for (const id of ids) claimed.set(id, (claimed.get(id) ?? 0) + 1);
    }
  }

  const doubled = new Set(
    [...claimed.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  );
  if (doubled.size) {
    problems.push(
      `Clusters claimed more than once: ${[...doubled].join(', ')}.`,
    );
  }
  const decisions = accepted.filter(
    (decision) => !decision.clusterIds.some((id) => doubled.has(id)),
  );
  const resolved = new Set(
    decisions.flatMap((decision) => decision.clusterIds),
  );

  return {
    decisions,
    unresolvedClusterIds: clusterIds.filter((id) => !resolved.has(id)),
    problems,
  };
}

/**
 * Words that mean public text was written from the code's point of view —
 * page paths, identifiers, vendors, infrastructure. The prompt forbids them;
 * this is the check that it listened. A public update carrying one is still
 * published (publishing is automatic), but its confidence is capped so the
 * team digest lists it under "worth a second look".
 */
const JARGON: [RegExp, string][] = [
  [/(^|\s)\/[a-z0-9][\w/-]*/i, 'a page path'],
  [/\b[a-z]+_[a-z_]+\b/, 'a code identifier'],
  [/\b[a-z]+[A-Z][a-zA-Z]+\b/, 'a code identifier'],
  [/\b\d+(\.\d+)?\s?(ms|s|sec|secs|seconds)\b/i, 'a timing threshold'],
  [/\bv\d+(\.\d+)+\b/i, 'a version number'],
  [
    /\b(ElevenLabs|Sarvam|Deepgram|Beyond Presence|Tavus|LiveKit|OpenAI|Gemini|Claude|GPT|Anthropic|PostHog|GitHub|AWS|Redis|Postgres|Weaviate)\b/i,
    'a vendor or service name',
  ],
  [
    /\b(API|endpoint|backend|frontend|database|webhook|JSON|CSV|TTS|STT|LLM|watchdog|timeout|migration|pull request|SJT|TypeError|null|undefined|stack trace|re-?renders?|re-?rendering|refetch(es|ed|ing)?|AAQ-\d+|OPP-\d+)\b/i,
    'a technical term',
  ],
  [/\b[a-z]{2}-[A-Z]{2}\b/, 'a locale code'],
];

/** Mixed-case product names that are not code identifiers. */
const PROPER_MIXED_CASE = /\b(iOS|iPhone|iPad|iPadOS|macOS|eLearning)\b/g;

export function jargonIn(text: string): string[] {
  const cleaned = text.replace(PROPER_MIXED_CASE, '');
  return [
    ...new Set(
      JARGON.filter(([pattern]) => pattern.test(cleaned)).map(
        ([, label]) => label,
      ),
    ),
  ];
}

/** Confidence a public update with jargon in its public text is capped at. */
export const JARGON_CONFIDENCE_CAP = 0.4;

/**
 * The rules no model reply can override, applied to a draft before it is saved:
 *
 *  - a draft made only of staff-only changes is internal, full stop;
 *  - a public draft whose title or summary carries jargon keeps its text but
 *    has its confidence capped, which is what puts it in front of a person.
 */
export function enforceGuards<T extends Partial<DraftUpdate>>(
  draft: T,
  options: { staffOnly: boolean },
): T & { guardNotes: string[] } {
  const guarded = { ...draft, guardNotes: [] as string[] };
  if (options.staffOnly && guarded.audience === 'public') {
    guarded.audience = 'internal';
    guarded.guardNotes.push(
      'Every change in it is in a staff-only area, so it was kept internal.',
    );
  }
  if (guarded.audience === 'public') {
    const found = jargonIn(`${guarded.title ?? ''}\n${guarded.summary ?? ''}`);
    if (found.length) {
      guarded.confidence = Math.min(
        guarded.confidence ?? 1,
        JARGON_CONFIDENCE_CAP,
      );
      guarded.guardNotes.push(`Public text contains ${found.join(', ')}.`);
    }
  }
  return guarded;
}
