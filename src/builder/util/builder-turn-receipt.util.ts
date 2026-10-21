import { BUILDER_EVIDENCE_TOOLS } from '../service/builder-evidence-log.service';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderPrdDocument } from '../type/builder-prd.type';
import { BuilderTurnReceipt } from '../type/builder-sse.type';
import { PRD_SECTION_KEYS, PRD_SECTION_LABELS } from './builder-prd-edits.util';

/**
 * The receipt under every interview turn: what it read, searched and changed,
 * and what failed — built from the tool results and the PRD itself, never from
 * the model's account of its own turn.
 *
 * It exists because the model's prose was the only record. In session 2bc3a5cf
 * six tool failures arrived after Builder had already replied, the last PRD
 * edit failed under a reply saying the PRD was revised, and past forty messages
 * the history summary kept the prose and dropped the failures. A receipt is
 * what the system knows happened, in the place the admin is already reading.
 */

/** Tools that end the turn; the reply itself, not something the turn did. */
export const BUILDER_TERMINAL_TOOLS = new Set([
  'ask_admin',
  'finish_turn',
  'submit_situation_brief',
]);

/** Tools that write the PRD. */
export const BUILDER_PRD_EDIT_TOOLS = new Set([
  'update_prd',
  'set_section',
  'upsert_requirement',
  'remove_requirement',
  'set_repo_plan',
  'remove_repo_plan',
  'upsert_assumption',
  'set_open_questions',
]);

/** Lookups: a result the model has to read before what it says can rest on it. */
export function isResearchTool(name: string): boolean {
  return BUILDER_EVIDENCE_TOOLS.has(name) || name === 'list_repo_commands';
}

const clip = (value: unknown, max: number): string => {
  const flat = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const quoted = (value: unknown): string => `"${clip(value, 80)}"`;

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const sectionLabel = (key: unknown): string =>
  PRD_SECTION_LABELS[String(key) as keyof typeof PRD_SECTION_LABELS] ??
  String(key ?? '');

/** What a call set out to do, in the admin's terms. */
export function describeToolAttempt(
  name: string,
  input: Record<string, any> = {},
): string {
  const inRepo = input?.repo ? ` in ${input.repo}` : '';
  switch (name) {
    case 'github_read_file':
      return `Read ${input?.repo}/${input?.path}`;
    case 'wiki_read':
      return `Read ${input?.path}`;
    case 'stacks_get':
      return 'Read Stacks guidance';
    case 'github_search_code':
      return `Code search ${quoted(input?.query)}${inRepo}`;
    case 'github_repo_tree':
      return `Listed files in ${input?.repo}${input?.path ? `/${input.path}` : ''}`;
    case 'docs_search':
      return `Docs search ${quoted(input?.query)}${inRepo}`;
    case 'wiki_search':
      return `Wiki search ${quoted(input?.query)}`;
    case 'stacks_search':
      return `Stacks search ${quoted(input?.query)}`;
    case 'capability_lookup':
      return `Platform map ${quoted(input?.query)}`;
    case 'ai_tasks_lookup':
      return `AI task registry ${quoted(input?.query)}`;
    case 'analytics_ask':
      return `Analytics ${quoted(input?.question)}`;
    case 'prod_errors':
      return `Production errors in ${input?.repo}${
        input?.search ? ` (${quoted(input.search)})` : ''
      }`;
    case 'bug_findings_search':
      return `Open Bug Hunter findings${inRepo}`;
    case 'ux_signals_lookup':
      return `UX signals${input?.query ? ` ${quoted(input.query)}` : ''}`;
    case 'list_repo_commands':
      return 'Repo commands';
    case 'update_prd': {
      const paths = (Array.isArray(input?.ops) ? input.ops : [])
        .map((op: { path?: unknown }) => String(op?.path ?? ''))
        .filter(Boolean);
      return paths.length
        ? `PRD edit at ${paths.slice(0, 3).join(', ')}${
            paths.length > 3 ? ` and ${paths.length - 3} more` : ''
          }`
        : 'PRD edit';
    }
    case 'set_section':
      return `PRD edit: ${sectionLabel(input?.section)}`;
    case 'upsert_requirement':
      return `PRD edit: requirement ${input?.id ?? '?'}`;
    case 'remove_requirement':
      return `PRD edit: remove requirement ${input?.id ?? '?'}`;
    case 'set_repo_plan':
      return `PRD edit: ${input?.repo ?? '?'} plan`;
    case 'remove_repo_plan':
      return `PRD edit: remove the ${input?.repo ?? '?'} plan`;
    case 'upsert_assumption':
      return `PRD edit: assumption ${input?.id ?? '?'}`;
    case 'set_open_questions':
      return 'PRD edit: open questions';
    case 'dismiss_review_finding':
      return `Dismiss review finding ${input?.findingId ?? '?'}`;
    default:
      return name;
  }
}

/** What a successful lookup came back with, when it is countable. */
function describeFound(name: string, result: Record<string, any>): string {
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  if (name === 'analytics_ask') return clip(result?.outcome ?? 'answered', 60);
  if (name === 'ux_signals_lookup') {
    return `${plural(length(result?.findings), 'finding')}, ${plural(
      length(result?.suggestions),
      'suggestion',
    )}`;
  }
  if (Array.isArray(result?.results)) {
    return plural(length(result.results), 'match', 'matches');
  }
  if (Array.isArray(result?.files)) return plural(length(result.files), 'file');
  if (Array.isArray(result?.shapes)) {
    return plural(length(result.shapes), 'error shape');
  }
  if (Array.isArray(result?.findings)) {
    return plural(length(result.findings), 'finding');
  }
  if (Array.isArray(result?.repos)) return plural(length(result.repos), 'repo');
  return 'done';
}

/** Why a call failed, from what it returned. */
export function describeToolFailure(result: Record<string, any>): string {
  return clip(result?.message ?? result?.error ?? 'failed', 200);
}

/** One call the turn made, joined to the result it got. */
export interface BuilderReceiptCall {
  name: string;
  input: Record<string, any>;
  result: Record<string, any> | undefined;
}

/** Calls and results as the transcript stores them, joined by tool_use id. */
export function joinCallsToResults(
  toolCalls: Record<string, any>[] | null | undefined,
  toolResults: Record<string, any>[] | null | undefined,
): BuilderReceiptCall[] {
  const byId = new Map(
    (toolResults ?? []).map((result) => [String(result?.toolUseId), result]),
  );
  return (toolCalls ?? []).map((call) => ({
    name: String(call?.name ?? ''),
    input: (call?.input ?? {}) as Record<string, any>,
    result: byId.get(String(call?.id))?.result as
      | Record<string, any>
      | undefined,
  }));
}

/** Rows of a keyed list, by key; rows without one fall back to their position. */
function keyedRows<T>(
  rows: T[] | null | undefined,
  key: (row: T) => string,
): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const handle = key(row).trim() || `#${index + 1}`;
    map.set(handle, JSON.stringify(row));
  });
  return map;
}

/** "added R4, R5; revised R2; removed R1" — empty when nothing moved. */
function describeKeyedChanges(
  before: Map<string, string>,
  after: Map<string, string>,
  extra?: (handle: string) => string | null,
): string {
  const added = [...after.keys()].filter((handle) => !before.has(handle));
  const removed = [...before.keys()].filter((handle) => !after.has(handle));
  const revised: string[] = [];
  const special: Record<string, string[]> = {};
  for (const [handle, value] of after) {
    if (!before.has(handle) || before.get(handle) === value) continue;
    const label = extra?.(handle);
    if (label) {
      (special[label] ??= []).push(handle);
    } else {
      revised.push(handle);
    }
  }
  return [
    added.length ? `added ${added.join(', ')}` : '',
    ...Object.entries(special).map(
      ([label, handles]) => `${label} ${handles.join(', ')}`,
    ),
    revised.length ? `revised ${revised.join(', ')}` : '',
    removed.length ? `removed ${removed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * What moved between two drafts, by section label, requirement id, assumption
 * id and repo name — the handles the admin and the plan use, not positions.
 */
export function describePrdChanges(
  before: BuilderPrdDocument | null | undefined,
  after: BuilderPrdDocument | null | undefined,
): string[] {
  const from = (before ?? {}) as Record<string, any>;
  const to = (after ?? {}) as Record<string, any>;
  const lines: string[] = [];

  for (const key of PRD_SECTION_KEYS) {
    const read = (doc: Record<string, any>) =>
      String(
        (key === 'dataModelMd' || key === 'apiMd'
          ? doc.technicalPlan?.[key]
          : doc[key]) ?? '',
      ).trim();
    const was = read(from);
    const now = read(to);
    if (was === now) continue;
    lines.push(
      `${PRD_SECTION_LABELS[key]} ${!was ? 'written' : !now ? 'cleared' : 'revised'}`,
    );
  }

  const requirements = describeKeyedChanges(
    keyedRows(from.requirements, (row: any) => String(row?.id ?? '')),
    keyedRows(to.requirements, (row: any) => String(row?.id ?? '')),
  );
  if (requirements) lines.push(`Requirements: ${requirements}`);

  const assumptionsBefore = new Map(
    (Array.isArray(from.assumptions) ? from.assumptions : []).map(
      (row: any) => [String(row?.id ?? ''), row?.status],
    ),
  );
  const assumptionsAfter = new Map(
    (Array.isArray(to.assumptions) ? to.assumptions : []).map((row: any) => [
      String(row?.id ?? ''),
      row?.status,
    ]),
  );
  const assumptions = describeKeyedChanges(
    keyedRows(from.assumptions, (row: any) => String(row?.id ?? '')),
    keyedRows(to.assumptions, (row: any) => String(row?.id ?? '')),
    (handle) =>
      assumptionsBefore.get(handle) !== 'confirmed' &&
      assumptionsAfter.get(handle) === 'confirmed'
        ? 'confirmed'
        : null,
  );
  if (assumptions) lines.push(`Assumptions: ${assumptions}`);

  const plans = describeKeyedChanges(
    keyedRows(from.technicalPlan?.repos, (row: any) => String(row?.repo ?? '')),
    keyedRows(to.technicalPlan?.repos, (row: any) => String(row?.repo ?? '')),
  );
  if (plans) lines.push(`Technical plan: ${plans}`);

  const questions = (doc: Record<string, any>) =>
    new Set(
      (Array.isArray(doc.openQuestions) ? doc.openQuestions : [])
        .map((question: unknown) => String(question ?? '').trim())
        .filter(Boolean),
    );
  const asked = questions(from);
  const open = questions(to);
  const raised = [...open].filter((question) => !asked.has(question)).length;
  const settled = [...asked].filter((question) => !open.has(question)).length;
  if (raised || settled) {
    lines.push(
      `Open questions: ${[
        raised ? `${raised} added` : '',
        settled ? `${settled} settled` : '',
      ]
        .filter(Boolean)
        .join(', ')}`,
    );
  }
  return lines;
}

const unique = (lines: string[]): string[] => [...new Set(lines)];

/**
 * The receipt for one turn.
 *
 * `before`/`after` are the draft at the start and end of the turn, so
 * `changed` describes what the document now holds rather than what the edits
 * meant to do — two edits that cancel out change nothing, and say so.
 */
export function buildTurnReceipt(input: {
  calls: BuilderReceiptCall[];
  before: BuilderPrdDocument | null;
  after: BuilderPrdDocument | null;
  versionFrom: number;
  versionTo: number;
  warnings?: string[];
  prdUnchangedBecause?: string | null;
}): BuilderTurnReceipt {
  const read: string[] = [];
  const searched: string[] = [];
  const failed: string[] = [];

  for (const call of input.calls) {
    if (!call.name || BUILDER_TERMINAL_TOOLS.has(call.name)) continue;
    // A call with no result never ran to completion (an interrupted turn);
    // it is neither done nor failed, so it is not on the receipt.
    if (!call.result) continue;
    if (call.result.ok === false) {
      failed.push(
        `${describeToolAttempt(call.name, call.input)} — ${describeToolFailure(
          call.result,
        )}`,
      );
      continue;
    }
    if (call.name === 'github_read_file') {
      read.push(`${call.input?.repo}/${call.input?.path}`);
    } else if (call.name === 'wiki_read') {
      read.push(String(call.input?.path ?? ''));
    } else if (call.name === 'stacks_get') {
      const titles = (
        Array.isArray(call.result?.chunks) ? call.result.chunks : []
      )
        .map((chunk: { title?: unknown }) => clip(chunk?.title, 80))
        .filter(Boolean);
      read.push(
        ...(titles.length
          ? titles.map((title: string) => `Stacks: ${title}`)
          : ['Stacks guidance']),
      );
    } else if (isResearchTool(call.name)) {
      searched.push(
        `${describeToolAttempt(call.name, call.input)} — ${describeFound(
          call.name,
          call.result,
        )}`,
      );
    }
  }

  const unchangedBecause = clip(input.prdUnchangedBecause ?? '', 300);
  return {
    read: unique(read.filter(Boolean)),
    searched: unique(searched),
    changed:
      input.versionTo !== input.versionFrom
        ? describePrdChanges(input.before, input.after)
        : [],
    prdVersion: { from: input.versionFrom, to: input.versionTo },
    failed,
    warnings: unique(input.warnings ?? []),
    ...(unchangedBecause ? { prdUnchangedBecause: unchangedBecause } : {}),
  };
}

/** A receipt-shaped object, or null — rows written before receipts have none. */
export function storedReceipt(
  message: BuilderMessage,
): BuilderTurnReceipt | null {
  const receipt = message.metadata?.receipt;
  return receipt && typeof receipt === 'object' && Array.isArray(receipt.read)
    ? (receipt as BuilderTurnReceipt)
    : null;
}

/**
 * The receipt of a stored turn: the one it was given, or for a row from before
 * receipts, one rebuilt from its tool calls — without a PRD diff, so its
 * changes are the edits that succeeded rather than what they did.
 */
export function receiptOfStoredTurn(
  message: BuilderMessage,
): BuilderTurnReceipt {
  const stored = storedReceipt(message);
  if (stored) return stored;
  const calls = joinCallsToResults(message.toolCalls, message.toolResults);
  const receipt = buildTurnReceipt({
    calls,
    before: null,
    after: null,
    versionFrom: 0,
    versionTo: 0,
  });
  receipt.changed = calls
    .filter(
      (call) =>
        BUILDER_PRD_EDIT_TOOLS.has(call.name) &&
        call.result &&
        call.result.ok !== false,
    )
    .map((call) =>
      call.name === 'update_prd' && call.input?.changeSummary
        ? `PRD edit: ${clip(call.input.changeSummary, 120)}`
        : describeToolAttempt(call.name, call.input),
    );
  return receipt;
}

/** True when a receipt says nothing — no lookups, no changes, no problems. */
export function receiptIsEmpty(receipt: BuilderTurnReceipt): boolean {
  return (
    !receipt.read.length &&
    !receipt.searched.length &&
    !receipt.changed.length &&
    !receipt.failed.length &&
    !receipt.warnings.length &&
    !receipt.prdUnchangedBecause
  );
}

/**
 * One line for the history summary: what the turn read, changed and what
 * failed. Searches are counted, not listed — what they found is in what was
 * read and written next, and the summary is paid for on every later turn.
 */
export function renderReceiptLine(receipt: BuilderTurnReceipt): string {
  const parts: string[] = [];
  if (receipt.read.length) {
    const shown = receipt.read.slice(0, 6).join(', ');
    parts.push(
      `read ${shown}${
        receipt.read.length > 6 ? ` and ${receipt.read.length - 6} more` : ''
      }`,
    );
  }
  if (receipt.searched.length) {
    parts.push(plural(receipt.searched.length, 'search', 'searches'));
  }
  if (receipt.changed.length) {
    parts.push(`changed: ${receipt.changed.join('; ')}`);
  } else if (receipt.prdUnchangedBecause) {
    parts.push(`PRD unchanged because ${receipt.prdUnchangedBecause}`);
  }
  if (receipt.failed.length) parts.push(`FAILED: ${receipt.failed.join('; ')}`);
  if (receipt.warnings.length) {
    parts.push(`delivered with warnings: ${receipt.warnings.join('; ')}`);
  }
  return parts.join(' · ');
}
