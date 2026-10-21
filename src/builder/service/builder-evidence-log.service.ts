import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderEvidence } from '../entity/builder-evidence.entity';
import { BuilderEvidenceRepository } from '../repository/builder-knowledge.repository';

/** Matches the column CHECK with room to spare. */
const EXCERPT_MAX = 600;
const SOURCE_MAX = 500;

/**
 * Tools whose results are evidence about the platform. Edits and questions
 * are not lookups; recording them here would make "what did the session
 * read?" harder to answer, not easier.
 */
export const BUILDER_EVIDENCE_TOOLS = new Set([
  'github_search_code',
  'github_read_file',
  'github_repo_tree',
  'docs_search',
  'wiki_search',
  'wiki_read',
  'stacks_search',
  'stacks_get',
  'capability_lookup',
  'ai_tasks_lookup',
  'analytics_ask',
  'prod_errors',
  'bug_findings_search',
  'ux_signals_lookup',
]);

/**
 * The evidence log: what a Builder session looked up and what came back.
 *
 * Named apart from `BuilderEvidenceService`, which is the production-evidence
 * tool belt (analytics, CloudWatch, Bug Hunter findings). That service fetches
 * evidence; this one remembers every lookup, from whichever tool, so the PRD's
 * claims can be held to it.
 *
 * Writes are fire-and-forget: a lookup the interview needs must never fail
 * because its record could not be saved.
 */
@Injectable()
export class BuilderEvidenceLogService {
  private readonly logger = LoggerService.getInstance(
    BuilderEvidenceLogService.name,
  );

  constructor(private readonly evidenceRepository: BuilderEvidenceRepository) {}

  /** Record one tool result, if the tool is a lookup. */
  recordToolResult(
    sessionId: string,
    tool: string,
    input: Record<string, any>,
    result: Record<string, any>,
  ): void {
    if (!BUILDER_EVIDENCE_TOOLS.has(tool) || !sessionId) return;
    const ok = result?.ok !== false;
    const row = {
      sessionId,
      tool,
      source: describeSource(tool, input).slice(0, SOURCE_MAX),
      ok,
      excerpt: describeResult(tool, result, ok)?.slice(0, EXCERPT_MAX) ?? null,
    };
    void this.evidenceRepository.insert(row).catch((error: unknown) => {
      this.logger.warn(
        `Builder evidence for ${sessionId} not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  listBySession(sessionId: string): Promise<BuilderEvidence[]> {
    return this.evidenceRepository.listBySession(sessionId);
  }

  /**
   * The repo paths a session read successfully — what a claim in the PRD can
   * be checked against. Searches don't count: a search result is a list of
   * places to look, not something that was looked at.
   */
  async readPaths(sessionId: string): Promise<string[]> {
    try {
      const rows = await this.evidenceRepository.listBySession(sessionId);
      return [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.ok &&
                (row.tool === 'github_read_file' || row.tool === 'wiki_read'),
            )
            .map((row) => row.source),
        ),
      ];
    } catch {
      return [];
    }
  }

  /**
   * What the readiness rubric checks "What already exists" against: every
   * read, split by outcome, plus how many rows the log holds at all — zero
   * means a session from before the log existed, which the rubric skips
   * rather than blocks. Undefined when the log cannot be read, so a database
   * hiccup leaves the check out instead of failing every PRD.
   */
  async readOutcomes(sessionId: string): Promise<
    | {
        total: number;
        readOk: string[];
        readFailed: string[];
      }
    | undefined
  > {
    try {
      const rows = await this.evidenceRepository.listBySession(sessionId);
      const reads = rows.filter(
        (row) => row.tool === 'github_read_file' || row.tool === 'wiki_read',
      );
      return {
        total: rows.length,
        readOk: [
          ...new Set(reads.filter((row) => row.ok).map((row) => row.source)),
        ],
        readFailed: [
          ...new Set(reads.filter((row) => !row.ok).map((row) => row.source)),
        ],
      };
    } catch {
      return undefined;
    }
  }

  /**
   * A compact list for a prompt: what was read and what was searched, failures
   * marked. Used by the PRD reviewer and the technical design so both start
   * from what the interview found.
   */
  async renderForPrompt(sessionId: string, max = 80): Promise<string> {
    let rows: BuilderEvidence[] = [];
    try {
      rows = await this.evidenceRepository.listBySession(sessionId);
    } catch {
      return '';
    }
    if (!rows.length) return '';
    const lines = rows
      .slice(-max)
      .map(
        (row) =>
          `- ${row.ok ? '' : '[FAILED] '}${row.tool}: ${row.source}${
            row.excerpt
              ? ` — ${row.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`
              : ''
          }`,
      );
    return lines.join('\n');
  }
}

function describeSource(tool: string, input: Record<string, any>): string {
  const repo = input?.repo ? String(input.repo) : '';
  switch (tool) {
    case 'github_read_file':
      return `${repo}:${String(input?.path ?? '')}`;
    case 'wiki_read':
      return `helloallytech.github.io:${String(input?.path ?? '')}`;
    case 'github_repo_tree':
      return `${repo}:${String(input?.path ?? '')}/`;
    case 'stacks_get':
      return `stacks:${(Array.isArray(input?.ids) ? input.ids : []).join(',')}`;
    default: {
      const query = String(
        input?.query ?? input?.question ?? input?.search ?? '',
      );
      return repo ? `${repo}: ${query}` : query;
    }
  }
}

function describeResult(
  tool: string,
  result: Record<string, any>,
  ok: boolean,
): string | null {
  if (!ok) {
    return String(result?.message ?? result?.error ?? 'failed');
  }
  if (typeof result?.content === 'string') return result.content;
  const list =
    result?.results ??
    result?.hits ??
    result?.files ??
    result?.chunks ??
    result?.findings;
  if (Array.isArray(list)) {
    return list
      .slice(0, 12)
      .map((item: any) => (typeof item === 'string' ? item : describeHit(item)))
      .join(', ');
  }
  if (typeof result?.answer === 'string') return result.answer;
  return null;
}

/**
 * One search hit as `repo:path`. Catalog hits already carry the repo in their
 * path (`ally-be:src/learn`), and joining the two printed it twice.
 */
function describeHit(item: any): string {
  const where = String(item?.path ?? item?.name ?? item?.title ?? '');
  const repo = item?.repo ? String(item.repo) : '';
  if (!repo || where.startsWith(`${repo}:`)) return where || repo;
  return where ? `${repo}:${where}` : repo;
}
