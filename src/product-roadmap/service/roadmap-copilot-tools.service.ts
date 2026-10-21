import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AiService } from 'src/ai/service/ai.service';
import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { BuilderGithubReadService } from 'src/builder/service/builder-github-read.service';
import { BuilderStacksService } from 'src/builder/service/builder-stacks.service';
import { BuilderEvidenceService } from 'src/builder/service/builder-evidence.service';
import {
  BUILDER_REPO_NAMES,
  BUILDER_WIKI_REPO,
  isBuilderReadableRepo,
} from 'src/builder/constants/builder-repos.constants';

import { ROADMAP_COPILOT } from '../constants/product-roadmap.constants';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import { RoadmapInterviewNoteRepository } from '../repository/roadmap-content.repository';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { OpportunityResponseDto } from '../dto/roadmap-response.dto';
import { RoadmapOpportunityService } from './roadmap-opportunity.service';

/** The tool that ends a turn. Not research — the orchestrator intercepts it. */
export const COPILOT_SUBMIT_TOOL = 'submit_turn';

/** How much of an opportunity description a search result carries. */
const SEARCH_DESCRIPTION_CHARS = 400;
const SEARCH_LIMIT = 8;
/** Words that would match half the board and say nothing about which half. */
const SEARCH_STOPWORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'they',
  'them',
  'their',
  'have',
  'need',
  'needs',
  'want',
  'wants',
  'able',
  'when',
  'what',
  'which',
  'about',
  'into',
  'more',
  'some',
  'make',
  'users',
  'user',
  'ally',
]);
const VECTOR_LIMIT = 6;
/** Low on purpose: the copilot reads the matches and decides, so recall beats precision. */
const VECTOR_THRESHOLD = 0.3;
const INTERVIEW_SUMMARY_CHARS = 1200;
const INTERVIEW_LIMIT = 6;

export interface CopilotToolOutcome {
  /** What the model reads, already bounded to ROADMAP_COPILOT.TOOL_RESULT_MAX_CHARS. */
  modelResult: string;
  /** One line for the admin's activity feed: what was found, or that the lookup failed. */
  summary: string;
  ok: boolean;
}

/**
 * The opportunity copilot's research belt.
 *
 * Every tool is READ-ONLY. The copilot's only write is the turn it submits, and filing stays
 * the admin's own click — nothing here can create, vote on or edit an opportunity. That is
 * what makes it safe on the VOTE tier the interview has always been on: it can read what a
 * voter can already read in the admin console, through the same fail-soft wrappers Builder
 * uses, and no more.
 *
 * Production error logs (`prod_errors` in Builder's belt) are deliberately absent. They answer
 * "is this area broken", which is Bug Hunter's question, and they carry request data that has
 * no business in a filing conversation.
 */
@Injectable()
export class RoadmapCopilotToolsService {
  private readonly logger = LoggerService.getInstance(
    RoadmapCopilotToolsService.name,
  );

  constructor(
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly interviewNoteRepository: RoadmapInterviewNoteRepository,
    private readonly aiService: AiService,
    private readonly githubRead: BuilderGithubReadService,
    private readonly stacks: BuilderStacksService,
    private readonly evidence: BuilderEvidenceService,
  ) {}

  /**
   * Research tools first, `submit_turn` last — a stable order, because the tool list sits in
   * front of the cached system prefix and any reordering invalidates it.
   */
  getToolDefinitions(): AgentToolDefinition[] {
    return [
      {
        name: 'search_roadmap',
        description:
          'Search the existing roadmap for opportunities like the one being discussed — by ' +
          'meaning and by wording. Use it early: an idea that is already on the board, already ' +
          'released, or already being built changes the whole conversation (upvote it, extend ' +
          'it, or say why this is different). Returns code, stage, goal, size, votes and the ' +
          'start of the description.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What the opportunity is about, in a phrase',
            },
            stage: {
              type: 'array',
              items: {
                type: 'string',
                enum: Object.values(RoadmapOpportunityStage),
              },
              description: 'Optional stage filter; omit to search everything',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_opportunity',
        description:
          'Read one existing opportunity in full by its code (e.g. "OPP-0714"), after a search ' +
          'turned it up.',
        input_schema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
        },
      },
      {
        name: 'search_user_interviews',
        description:
          'Search the notes from real user interviews the team has logged — title, interviewee ' +
          'and summary. The best evidence there is that a need is real and who has it. Use a ' +
          'short keyword or two ("supervisor", "review queue"), not a sentence: it matches text.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'analytics_ask',
        description:
          'Ask one question about production usage in plain English and get a narrated answer ' +
          'with the SQL behind it. Use it to size an opportunity — how many people, how often — ' +
          'and to check a claim before it goes into the brief ("how many learners started a ' +
          'roleplay in the last 30 days and never finished one"). Read-only, row-capped, and ' +
          'slow: ask one sharp question rather than several vague ones.',
        input_schema: {
          type: 'object',
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
      },
      {
        name: 'ux_signals_lookup',
        description:
          'What product telemetry says people struggle with — rage clicks, dead clicks, ' +
          'abandoned routes, zero-result searches, funnel drop-off — with the window the scan ' +
          'covered. Check the window before stating anything in the present tense.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Optional substring over titles, routes and rationales; omit for everything open',
            },
          },
        },
      },
      {
        name: 'bug_findings_search',
        description:
          'Open Bug Hunter findings — what is already known to be broken. If the "opportunity" ' +
          'is really a defect someone is already fixing, say so.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Optional repo filter' },
          },
        },
      },
      {
        name: 'docs_search',
        description:
          "Search Ally's written documentation — every repo's README, CLAUDE.md and docs/ " +
          'pages, and the wiki — and get back matching file paths. The quickest way to learn ' +
          'how an area works today, what it is called and why it is built that way. Read the ' +
          'one or two that look right with github_read_file (or wiki_read for the wiki). ' +
          'Every word must match, so search one to three words — a screen label or feature ' +
          'name from the product map — never a sentence.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            repo: {
              type: 'string',
              enum: [...BUILDER_REPO_NAMES, BUILDER_WIKI_REPO],
              description: 'Optional; omit to search every repo and the wiki',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'github_search_code',
        description:
          'Search the Ally codebase and get back matching file paths. Use it to learn how an ' +
          'area works today when the docs do not say, and to check whether something already ' +
          'exists, half-exists, or lives behind a feature toggle — not to design the build. ' +
          'Every word must match, so search one identifier or one to three words. A ' +
          "screen's feature-toggle key from the product map finds its route and controller.",
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
          },
          required: ['query'],
        },
      },
      {
        name: 'github_read_file',
        description:
          'Read one file (truncated). Prefer docs, READMEs and the one service that matters ' +
          'over large files.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
            path: { type: 'string' },
          },
          required: ['repo', 'path'],
        },
      },
      {
        name: 'github_repo_tree',
        description: 'List files in a repo, optionally under one subpath.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
            path: { type: 'string' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'wiki_search',
        description:
          'Search the platform wiki — how the product and platform fit together, and why.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'wiki_read',
        description:
          'Read one wiki page by path, e.g. "wiki/platform/architecture.md".',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'stacks_search',
        description:
          "Search the team's curated product-guidance library — how to judge, size and frame an " +
          'opportunity, and how features like this one should behave. Specific noun phrases, ' +
          'not sentences. An empty result is not evidence the library lacks guidance.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'stacks_get',
        description:
          'Fetch the full text of one or two Stacks chunks by id, after a search.',
        input_schema: {
          type: 'object',
          properties: { ids: { type: 'array', items: { type: 'string' } } },
          required: ['ids'],
        },
      },
      {
        name: COPILOT_SUBMIT_TOOL,
        description:
          'End your turn. Call this exactly once, as the LAST thing you do every turn, with ' +
          'your message to the admin, a verdict on every readiness criterion, the draft (or ' +
          'null), and the brief as it now stands. Nothing you write outside this call reaches ' +
          'the admin.',
        input_schema: {
          type: 'object',
          properties: {
            reply: {
              type: 'string',
              description:
                'Your message to the admin: what you found that matters, your recommendation, ' +
                'and ONE question. Plain prose, no markdown.',
            },
            gates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  met: { type: 'boolean' },
                  note: { type: 'string' },
                },
                required: ['id', 'met', 'note'],
              },
            },
            draft: {
              type: 'object',
              nullable: true,
              description: 'Null while any criterion is unmet.',
              properties: {
                description: { type: 'string' },
                productGoal: { type: 'string', nullable: true },
                effort: {
                  type: 'string',
                  nullable: true,
                  enum: ['s', 'm', 'l', 'xl', 'xxl'],
                },
              },
            },
            brief: {
              type: 'object',
              properties: {
                strategicFit: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      goal: { type: 'string' },
                      why: { type: 'string' },
                    },
                    required: ['goal', 'why'],
                  },
                },
                reach: {
                  type: 'object',
                  properties: {
                    howMany: { type: 'string', nullable: true },
                    howOften: { type: 'string', nullable: true },
                  },
                },
                evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source: {
                        type: 'string',
                        enum: [
                          'admin',
                          'analytics',
                          'ux_signals',
                          'bug_findings',
                          'user_interviews',
                          'roadmap',
                          'codebase',
                          'wiki',
                          'stacks',
                          'strategy',
                        ],
                      },
                      claim: { type: 'string' },
                      ref: { type: 'string', nullable: true },
                    },
                    required: ['source', 'claim'],
                  },
                },
                successMetric: { type: 'string', nullable: true },
                assumptions: { type: 'array', items: { type: 'string' } },
                alternativesDropped: {
                  type: 'array',
                  items: { type: 'string' },
                },
                assessment: {
                  type: 'object',
                  properties: {
                    rating: {
                      type: 'string',
                      enum: ['needs_work', 'promising', 'strong'],
                    },
                    summary: { type: 'string' },
                    openRecommendations: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['rating', 'summary', 'openRecommendations'],
                },
              },
              required: ['assessment'],
            },
          },
          required: ['reply', 'gates', 'draft', 'brief'],
        },
      },
    ];
  }

  /**
   * The line the admin sees while a lookup runs. Written for them, so it names what is being
   * checked in their terms — "Searching the roadmap for …", not a tool name.
   */
  describe(name: string, input: Record<string, any>): string {
    const q = (value: unknown) => `"${String(value ?? '').slice(0, 80)}"`;
    switch (name) {
      case 'search_roadmap':
        return `Searching the roadmap for ${q(input?.query)}`;
      case 'get_opportunity':
        return `Reading ${String(input?.code ?? 'an opportunity')}`;
      case 'search_user_interviews':
        return `Searching user interview notes for ${q(input?.query)}`;
      case 'analytics_ask':
        return `Asking analytics: ${String(input?.question ?? '').slice(0, 140)}`;
      case 'ux_signals_lookup':
        return input?.query
          ? `Checking UX friction signals for ${q(input.query)}`
          : 'Checking UX friction signals';
      case 'bug_findings_search':
        return input?.repo
          ? `Checking known bugs in ${input.repo}`
          : 'Checking known bugs';
      case 'docs_search':
        return `Searching the docs for ${q(input?.query)}`;
      case 'github_search_code':
        return `Searching the code for ${q(input?.query)}`;
      case 'github_read_file':
        return `Reading ${input?.repo}/${input?.path}`;
      case 'github_repo_tree':
        return `Browsing ${input?.repo}${input?.path ? `/${input.path}` : ''}`;
      case 'wiki_search':
        return `Searching the wiki for ${q(input?.query)}`;
      case 'wiki_read':
        return `Reading wiki page ${input?.path}`;
      case 'stacks_search':
        return `Looking up product guidance on ${q(input?.query)}`;
      case 'stacks_get':
        return 'Reading product guidance';
      default:
        return `Running ${name}`;
    }
  }

  /**
   * Run one research tool. Never throws: a failed lookup comes back as `ok: false` with a
   * reason the model can read, because a model told only "error" concludes the source is
   * empty and asserts that to the admin.
   */
  async execute(
    name: string,
    input: Record<string, any>,
    ctx: { userId: number },
  ): Promise<CopilotToolOutcome> {
    try {
      const { result, summary } = await this.run(name, input ?? {}, ctx);
      const ok = result?.ok !== false;
      return {
        modelResult: bound(JSON.stringify(result ?? { ok: true })),
        summary: ok
          ? summary(result)
          : `Couldn't check: ${String(result?.error ?? 'unknown error')}`,
        ok,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ROADMAP] Copilot tool ${name} failed: ${message}`);
      return {
        modelResult: JSON.stringify({ ok: false, error: message }),
        summary: `Couldn't check: ${message}`,
        ok: false,
      };
    }
  }

  private async run(
    name: string,
    input: Record<string, any>,
    ctx: { userId: number },
  ): Promise<{ result: any; summary: (result: any) => string }> {
    switch (name) {
      case 'search_roadmap':
        return {
          result: await this.searchRoadmap(
            ctx.userId,
            String(input.query ?? ''),
            Array.isArray(input.stage) ? input.stage.map(String) : undefined,
          ),
          summary: (r) =>
            count(r.matches, 'related opportunity', 'related opportunities'),
        };
      case 'get_opportunity':
        return {
          result: await this.getOpportunity(
            ctx.userId,
            String(input.code ?? ''),
          ),
          summary: (r) => `Read ${r.opportunity?.code ?? 'it'}`,
        };
      case 'search_user_interviews':
        return {
          result: await this.searchInterviews(String(input.query ?? '')),
          summary: (r) => count(r.interviews, 'interview note'),
        };
      case 'analytics_ask':
        return {
          result: await this.evidence.analyticsAsk(
            String(input.question ?? ''),
            ctx.userId,
          ),
          summary: (r) =>
            r.answer
              ? String(r.answer).replace(/\s+/g, ' ').slice(0, 160)
              : `Analytics: ${r.outcome ?? 'answered'}${
                  r.message
                    ? ` — ${String(r.message).replace(/\s+/g, ' ').slice(0, 140)}`
                    : ''
                }`,
        };
      case 'ux_signals_lookup':
        return {
          result: await this.evidence.uxSignals(
            input.query ? String(input.query) : undefined,
          ),
          summary: (r) =>
            `${count(r.findings, 'friction finding')}, ${count(r.suggestions, 'suggestion')}`,
        };
      case 'bug_findings_search':
        return {
          result: await this.evidence.openFindings(
            input.repo ? String(input.repo) : undefined,
          ),
          summary: (r) => count(r.findings, 'open finding'),
        };
      case 'docs_search':
        return {
          result: await this.searchDocs(
            String(input.query ?? ''),
            input.repo ? String(input.repo) : undefined,
          ),
          summary: (r) => count(r.results, 'matching page'),
        };
      case 'github_search_code':
        return {
          result: await this.githubRead.searchCode(
            String(input.query ?? ''),
            input.repo ? String(input.repo) : undefined,
          ),
          summary: (r) => count(r.results, 'matching file'),
        };
      case 'github_read_file':
        return {
          result: await this.githubRead.readFile(
            String(input.repo ?? ''),
            String(input.path ?? ''),
          ),
          summary: () => 'Read',
        };
      case 'github_repo_tree':
        return {
          result: await this.githubRead.repoTree(
            String(input.repo ?? ''),
            input.path ? String(input.path) : undefined,
          ),
          summary: (r) => count(r.files, 'file'),
        };
      case 'wiki_search':
        return {
          result: await this.githubRead.searchCode(
            String(input.query ?? ''),
            BUILDER_WIKI_REPO,
          ),
          summary: (r) => count(r.results, 'page'),
        };
      case 'wiki_read':
        return {
          result: await this.githubRead.readFile(
            BUILDER_WIKI_REPO,
            String(input.path ?? ''),
          ),
          summary: () => 'Read',
        };
      case 'stacks_search':
        return {
          result: await this.stacks.search(String(input.query ?? ''), 4),
          summary: (r) =>
            count(r.results, 'piece of guidance', 'pieces of guidance'),
        };
      case 'stacks_get':
        return {
          result: await this.stacks.getChunks(
            Array.isArray(input.ids) ? input.ids.map(String).slice(0, 3) : [],
          ),
          summary: (r) => count(r.chunks, 'section', 'sections'),
        };
      default:
        return {
          result: { ok: false, error: `Unknown tool "${name}"` },
          summary: () => '',
        };
    }
  }

  /**
   * Meaning first, then wording. The vector index finds the paraphrase ("supervisors can't
   * see what they reviewed" vs "review status in the session list"); the substring search
   * finds the exact phrase the vector missed. Either failing degrades to the other — a dead
   * ally-ai must not make the copilot conclude the board is empty and wave a duplicate through.
   */
  private async searchRoadmap(
    userId: number,
    query: string,
    stage?: string[],
  ): Promise<Record<string, any>> {
    const trimmed = query.trim();
    if (!trimmed)
      return { ok: false, error: 'Give me something to search for.' };

    const found = new Map<string, OpportunityResponseDto>();
    const notes: string[] = [];

    try {
      const similar = await this.aiService.findSimilarRoadmapOpportunities({
        description: trimmed,
        limit: VECTOR_LIMIT,
        threshold: VECTOR_THRESHOLD,
      });
      const ids = (similar?.matches ?? []).map((m: any) => m.opportunity_id);
      const rows = await Promise.all(
        ids.map((id: string) =>
          this.opportunityService.findOne(userId, id).catch(() => null),
        ),
      );
      for (const row of rows) if (row) found.set(row.id, row);
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Copilot vector search unavailable: ${(error as Error)?.message}`,
      );
      notes.push(
        'Meaning-based search was unavailable, so these are wording matches only.',
      );
    }

    try {
      const ids = await this.keywordMatches(trimmed, stage);
      const rows = await Promise.all(
        ids
          .filter((id) => !found.has(id))
          .map((id) =>
            this.opportunityService.findOne(userId, id).catch(() => null),
          ),
      );
      for (const row of rows) if (row) found.set(row.id, row);
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Copilot wording search failed: ${(error as Error)?.message}`,
      );
      notes.push('Wording search failed.');
    }

    const matches = [...found.values()]
      .filter((row) => !stage?.length || stage.includes(row.stage))
      .slice(0, SEARCH_LIMIT + VECTOR_LIMIT)
      .map(compactOpportunity);
    return { ok: true, matches, ...(notes.length ? { notes } : {}) };
  }

  /**
   * Opportunity ids ranked by how many of the query's words their description contains.
   *
   * Not the board's own `search` filter: that is one ILIKE over the whole phrase, which is right
   * for a person typing into a filter box and wrong for a model, whose queries are five-word
   * phrases that no description contains verbatim. Requiring two words (or the only one) keeps
   * "dashboard" from matching every row that mentions a dashboard.
   */
  private async keywordMatches(
    query: string,
    stage?: string[],
  ): Promise<string[]> {
    const words = [
      ...new Set(query.toLowerCase().match(/[\p{L}\p{M}\p{N}]{4,}/gu) ?? []),
    ]
      .filter((word) => !SEARCH_STOPWORDS.has(word))
      .slice(0, 6);
    if (!words.length) return [];

    const score = words
      .map((_, i) => `(CASE WHEN o.description ILIKE :w${i} THEN 1 ELSE 0 END)`)
      .join(' + ');
    const qb = this.opportunityRepository
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o.type = :idea', { idea: RoadmapOpportunityType.IDEA })
      .andWhere(`(${score}) >= :min`, { min: Math.min(2, words.length) });
    words.forEach((word, i) => qb.setParameter(`w${i}`, `%${word}%`));
    if (stage?.length) qb.andWhere('o.stage IN (:...stage)', { stage });
    const rows = await qb
      .orderBy(`(${score})`, 'DESC')
      .addOrderBy('o."createdAt"', 'DESC')
      .limit(SEARCH_LIMIT)
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  private async getOpportunity(
    userId: number,
    code: string,
  ): Promise<Record<string, any>> {
    const wanted = code.trim().toUpperCase();
    if (!wanted) return { ok: false, error: 'Which opportunity code?' };
    const row = await this.opportunityRepository.findOne({
      where: { code: wanted },
      select: { id: true },
    });
    if (!row)
      return { ok: false, error: `No opportunity with code ${wanted}.` };
    const full = await this.opportunityService.findOne(userId, row.id);
    return {
      ok: true,
      opportunity: {
        ...compactOpportunity(full),
        description: full.description,
        prd: full.prd ? full.prd.slice(0, 3000) : null,
        owner: full.owner ?? null,
        commentCount: full.commentCount,
        createdAt: full.createdAt,
      },
    };
  }

  /**
   * Code search narrowed to markdown. Org-wide by default, which reaches repos the copilot may
   * not read (infra, the Calibrate repos) — those hits are dropped rather than offered as
   * paths that `github_read_file` would then refuse.
   */
  private async searchDocs(
    query: string,
    repo?: string,
  ): Promise<Record<string, any>> {
    const trimmed = query.trim();
    if (!trimmed)
      return { ok: false, error: 'Give me something to search for.' };
    const found = await this.githubRead.searchCode(
      `${trimmed} extension:md`,
      repo,
    );
    if (found?.ok === false) return found;
    const results = (Array.isArray(found?.results) ? found.results : []).filter(
      (hit: { repo?: string }) =>
        !!hit?.repo && isBuilderReadableRepo(hit.repo),
    );
    return {
      ok: true,
      results,
      ...(results.length
        ? {}
        : {
            note: 'No page matched those words — try the name the product map uses, or one word, before concluding nothing is documented.',
          }),
    };
  }

  private async searchInterviews(query: string): Promise<Record<string, any>> {
    const trimmed = query.trim();
    const [notes, total] = await this.interviewNoteRepository.search(
      trimmed || undefined,
      INTERVIEW_LIMIT,
      0,
    );
    return {
      ok: true,
      total,
      interviews: notes.map((note) => ({
        title: note.title,
        interviewee: note.interviewee ?? null,
        date: note.createdAt,
        summary: note.summary
          ? note.summary.slice(0, INTERVIEW_SUMMARY_CHARS)
          : null,
      })),
      ...(total === 0
        ? {
            note: trimmed
              ? 'Nothing matched that wording — try a shorter keyword before concluding there is no interview evidence.'
              : 'No interview notes have been logged yet.',
          }
        : {}),
    };
  }
}

const compactOpportunity = (row: OpportunityResponseDto) => ({
  code: row.code,
  type: row.type,
  stage: row.stage,
  productGoal: row.productGoal,
  effort: row.effort ?? null,
  votes: row.priorityScore,
  voters: row.voterCount,
  queueRank: row.queueRank ?? null,
  releasedAt: row.releasedAt ?? null,
  description:
    row.description.length > SEARCH_DESCRIPTION_CHARS
      ? `${row.description.slice(0, SEARCH_DESCRIPTION_CHARS)}…`
      : row.description,
});

/** "1 file", "3 files", "No files" — the activity feed is read by people. */
const count = (list: unknown, one: string, many = `${one}s`): string => {
  const n = Array.isArray(list) ? list.length : 0;
  if (n === 0) return `No ${many}`;
  return `${n} ${n === 1 ? one : many}`;
};

/** A tool result the model can read in full — and a marker when it could not. */
const bound = (serialised: string): string =>
  serialised.length <= ROADMAP_COPILOT.TOOL_RESULT_MAX_CHARS
    ? serialised
    : `${serialised.slice(0, ROADMAP_COPILOT.TOOL_RESULT_MAX_CHARS)}… [truncated — narrow the lookup]`;
