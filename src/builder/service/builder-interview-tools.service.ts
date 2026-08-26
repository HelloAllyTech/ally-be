import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { JsonPatchOp } from 'src/roleplay-studio/util/json-patch.util';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdDoc } from '../entity/builder-prd-doc.entity';
import { BuilderPrdVersionAuthor } from '../enum/builder.enum';
import {
  BuilderQuestionOption,
  BuilderToolExecutionOutcome,
} from '../type/builder-sse.type';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderGithubReadService } from './builder-github-read.service';
import { BuilderStacksService } from './builder-stacks.service';
import {
  BUILDER_REPO_NAMES,
  BUILDER_REPOS,
} from '../constants/builder-repos.constants';
import { BUILDER_STACKS_DEFAULT_RESULTS } from '../constants/builder.constants';

/** Mutable per-turn context threaded through tool executions. */
export interface BuilderToolExecutionContext {
  session: BuilderSession;
  doc: BuilderPrdDoc;
  userId: number;
}

/**
 * The interview agent's tool belt.
 *
 * Two tools end the turn or change state — `ask_admin` hands control back to
 * the human, `update_prd` mutates the living document. The rest are research:
 * they let the agent ground a question in what the codebase and the product
 * library actually say, instead of asking the admin to supply context the
 * system already holds.
 */
@Injectable()
export class BuilderInterviewToolsService {
  private readonly logger = LoggerService.getInstance(
    BuilderInterviewToolsService.name,
  );

  constructor(
    private readonly prdService: BuilderPrdService,
    private readonly githubRead: BuilderGithubReadService,
    private readonly stacks: BuilderStacksService,
  ) {}

  getToolDefinitions(): any[] {
    return [
      {
        name: 'ask_admin',
        description:
          'Ask the admin ONE question and wait (the turn ends). This is the ' +
          'only way to ask — never put a question in plain prose. Unless the ' +
          'question is genuinely open-ended, use a select kind and offer 2-4 ' +
          'concrete options, each with a one-line description of its ' +
          'trade-off, and mark exactly one `recommended: true`. ALWAYS set ' +
          'allowCustom=true so the admin can answer in their own words. Use ' +
          '`rationale` to say why you are asking — especially when resolving ' +
          'a contradiction with an earlier answer or checking an assumption.',
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question to ask' },
            kind: {
              type: 'string',
              enum: ['freeText', 'singleSelect', 'multiSelect', 'dropdown'],
            },
            rationale: {
              type: 'string',
              description:
                'Why this question, now — e.g. "your answers on scope and ' +
                'timeline point in different directions".',
            },
            options: {
              type: 'array',
              description:
                'Choices for singleSelect/multiSelect/dropdown (omit for freeText)',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: {
                    type: 'string',
                    description: 'The trade-off in one line',
                  },
                  recommended: {
                    type: 'boolean',
                    description:
                      'Mark at most one option as your recommendation',
                  },
                },
                required: ['id', 'label'],
              },
            },
            allowCustom: { type: 'boolean' },
            allowNone: { type: 'boolean' },
            minSelections: { type: 'number' },
            maxSelections: { type: 'number' },
          },
          required: ['prompt', 'kind'],
        },
      },
      {
        name: 'update_prd',
        description:
          'Patch the living PRD with RFC-6902 operations (add / replace / ' +
          'remove only). Call this as you learn things — after most answers — ' +
          'rather than saving up a rewrite at the end: the admin watches the ' +
          'document fill in, and a patch persists even if the turn is later ' +
          'interrupted. Paths are JSON Pointers into the PRD document, e.g. ' +
          '"/problem", "/requirements/-", "/assumptions/0/status". On failure ' +
          'you get the failing operation index back and must self-repair.\n' +
          'Shapes matter, because three readers render this document as text: ' +
          'openQuestions and every acceptanceCriteria are arrays of plain ' +
          'sentences, not objects — write "Which tenant owns this?", never ' +
          '{"id":"q1","text":"..."}. Structured rows exist only where the ' +
          'schema says so: requirements are {id,title,description,' +
          'acceptanceCriteria}, assumptions are {id,text,status}, and ' +
          'technicalPlan.repos are {repo,changesMd}. Everything else is ' +
          'markdown prose.',
        input_schema: {
          type: 'object',
          properties: {
            ops: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  op: { type: 'string', enum: ['add', 'replace', 'remove'] },
                  path: { type: 'string' },
                  value: {},
                },
                required: ['op', 'path'],
              },
            },
            changeSummary: {
              type: 'string',
              description: 'One line on what moved, for the version history',
            },
          },
          required: ['ops'],
        },
      },
      {
        name: 'github_search_code',
        description:
          'Search code across the Ally org (or one repo) and get back matching ' +
          'file paths. Use this to check how something is already built before ' +
          'proposing it, then read the two or three files that matter.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Symbol, string or phrase to search for',
            },
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
          },
          required: ['query'],
        },
      },
      {
        name: 'github_read_file',
        description:
          'Read one file. Large files are truncated — prefer a specific path ' +
          'over a whole barrel or a 3000-line service.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
            path: { type: 'string' },
            ref: {
              type: 'string',
              description: 'Branch or sha (default master)',
            },
          },
          required: ['repo', 'path'],
        },
      },
      {
        name: 'github_repo_tree',
        description:
          'List files in a repo, optionally under one subpath. Use to orient ' +
          'inside an unfamiliar area before reading anything.',
        input_schema: {
          type: 'object',
          properties: {
            repo: { type: 'string', enum: BUILDER_REPO_NAMES },
            path: {
              type: 'string',
              description: 'Subpath filter, e.g. "src/builder"',
            },
            ref: { type: 'string' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'stacks_search',
        description:
          "Search the team's curated product-guidance library. Call this " +
          'whenever the interview reaches a product judgement — an empty, ' +
          'loading, edge or failure state; a user-facing label; a threshold, ' +
          'limit, cadence or reward rule; what a view shows and omits. Use ' +
          'specific noun phrases, not ticket titles. An empty result is not ' +
          'evidence the library lacks guidance — never claim coverage either way.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'A specific noun phrase' },
            maxResults: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['query'],
        },
      },
      {
        name: 'stacks_get',
        description:
          'Fetch the full text of one or two Stacks chunks by id, after a ' +
          'search. Cite the chunk title in the PRD wherever the guidance ' +
          'actually changed a decision.',
        input_schema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['ids'],
        },
      },
      {
        name: 'list_repo_commands',
        description:
          'The test / lint / typecheck commands and guarded paths for each ' +
          'repo. Use when writing the PRD test plan so it names commands that ' +
          'actually exist.',
        input_schema: { type: 'object', properties: {} },
      },
    ];
  }

  async execute(
    name: string,
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
  ): Promise<BuilderToolExecutionOutcome> {
    switch (name) {
      case 'ask_admin':
        return this.executeAskAdmin(input);
      case 'update_prd':
        return this.executeUpdatePrd(input, context);
      case 'github_search_code':
        return this.wrapResearch(
          await this.githubRead.searchCode(
            String(input?.query ?? ''),
            input?.repo ? String(input.repo) : undefined,
          ),
          (result) =>
            `Searched code for "${input?.query}": ${
              result.results?.length ?? 0
            } match(es)`,
        );
      case 'github_read_file':
        return this.wrapResearch(
          await this.githubRead.readFile(
            String(input?.repo ?? ''),
            String(input?.path ?? ''),
            input?.ref ? String(input.ref) : undefined,
          ),
          () => `Read ${input?.repo}/${input?.path}`,
        );
      case 'github_repo_tree':
        return this.wrapResearch(
          await this.githubRead.repoTree(
            String(input?.repo ?? ''),
            input?.path ? String(input.path) : undefined,
            input?.ref ? String(input.ref) : undefined,
          ),
          (result) =>
            `Listed ${result.files?.length ?? 0} file(s) in ${input?.repo}${
              input?.path ? `/${input.path}` : ''
            }`,
        );
      case 'stacks_search':
        return this.wrapResearch(
          await this.stacks.search(
            String(input?.query ?? ''),
            Number(input?.maxResults) || BUILDER_STACKS_DEFAULT_RESULTS,
            Array.isArray(input?.tags) ? input.tags.map(String) : undefined,
          ),
          (result) =>
            `Stacks: "${input?.query}" — ${result.results?.length ?? 0} hit(s)`,
        );
      case 'stacks_get':
        return this.wrapResearch(
          await this.stacks.getChunks(
            Array.isArray(input?.ids) ? input.ids.map(String) : [],
          ),
          (result) => `Read ${result.chunks?.length ?? 0} Stacks chunk(s)`,
        );
      case 'list_repo_commands':
        return {
          modelResult: {
            ok: true,
            repos: BUILDER_REPOS.map((repo) => ({
              repo: repo.repo,
              description: repo.description,
              test: repo.test,
              lint: repo.lint,
              typecheck: repo.typecheck,
              e2eCapable: repo.e2eCapable,
              guardedPaths: repo.guardedPaths,
            })),
          },
          summary: 'Listed repo commands',
        };
      default:
        return {
          modelResult: { ok: false, error: `Unknown tool "${name}"` },
          summary: `Unknown tool "${name}"`,
        };
    }
  }

  /**
   * Research tools share one shape: hand the raw result to the model, and a
   * one-line summary to the transcript. A failed lookup is returned, not
   * thrown — the model reads `ok:false` and either retries or says it could
   * not check.
   */
  private wrapResearch(
    result: Record<string, any>,
    summarize: (result: Record<string, any>) => string,
  ): BuilderToolExecutionOutcome {
    return {
      modelResult: result,
      summary: result.ok
        ? summarize(result)
        : `Lookup failed: ${result.error ?? 'unknown'}`,
    };
  }

  private executeAskAdmin(
    input: Record<string, any>,
  ): BuilderToolExecutionOutcome {
    const questionId = uuidv4();
    const selectKinds = ['singleSelect', 'multiSelect', 'dropdown'];
    let kind = String(input?.kind ?? 'freeText');
    if (![...selectKinds, 'freeText'].includes(kind)) kind = 'freeText';

    const isSelect = selectKinds.includes(kind);
    const options = isSelect ? this.normalizeOptions(input?.options) : [];

    const question: Record<string, any> = {
      id: questionId,
      prompt: String(input?.prompt ?? ''),
      kind,
      ...(input?.rationale ? { rationale: String(input.rationale) } : {}),
      ...(options.length ? { options } : {}),
      // A select question without a custom escape hatch forces the admin to
      // pick a wrong answer, so it is on by default rather than on request.
      allowCustom: isSelect
        ? input?.allowCustom !== false
        : Boolean(input?.allowCustom),
      ...(input?.allowNone ? { allowNone: true } : {}),
      ...(typeof input?.minSelections === 'number'
        ? { minSelections: input.minSelections }
        : {}),
      ...(typeof input?.maxSelections === 'number'
        ? { maxSelections: input.maxSelections }
        : {}),
    };

    return {
      modelResult: {
        ok: true,
        questionId,
        note: 'Question delivered; the admin answers in their next message.',
      },
      summary: `Asked: ${question.prompt}`,
      events: [{ event: 'question', data: question }],
      endTurn: true,
    };
  }

  /** Accepts {id,label,description?,recommended?} objects or bare strings. */
  private normalizeOptions(raw: unknown): BuilderQuestionOption[] {
    if (!Array.isArray(raw)) return [];
    const options = raw
      .map((option) => {
        if (typeof option === 'string') {
          const value = option.trim();
          return value ? { id: value, label: value } : null;
        }
        if (option && typeof option === 'object') {
          const source = option as Record<string, any>;
          const id = String(source.id ?? source.label ?? '').trim();
          const label = String(source.label ?? source.id ?? '').trim();
          if (!id || !label) return null;
          return {
            id,
            label,
            ...(source.description
              ? { description: String(source.description) }
              : {}),
            ...(source.recommended ? { recommended: true } : {}),
          };
        }
        return null;
      })
      .filter(Boolean) as BuilderQuestionOption[];

    // Keep at most one recommendation: two "recommended" chips is no
    // recommendation at all, and the UI focuses the first for one-key answering.
    let seenRecommended = false;
    for (const option of options) {
      if (!option.recommended) continue;
      if (seenRecommended) {
        delete option.recommended;
      } else {
        seenRecommended = true;
      }
    }
    return options;
  }

  /**
   * Apply the model's patch to the PRD and emit the updated document plus its
   * recomputed readiness, so the panel and the readiness ring move together.
   */
  private async executeUpdatePrd(
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
  ): Promise<BuilderToolExecutionOutcome> {
    const ops = (Array.isArray(input?.ops) ? input.ops : []) as JsonPatchOp[];
    if (!ops.length) {
      return {
        modelResult: {
          ok: false,
          error: 'no_ops',
          message: 'update_prd needs at least one operation.',
        },
        summary: 'PRD patch rejected: no operations',
      };
    }

    try {
      const { doc } = await this.prdService.applyPatch(
        context.doc,
        ops,
        context.userId,
        BuilderPrdVersionAuthor.AGENT,
        input?.changeSummary ? String(input.changeSummary) : undefined,
      );
      context.doc = doc;
      const readiness = this.prdService.computeReadiness(doc.draft);

      return {
        modelResult: {
          ok: true,
          versionNumber: doc.versionNumber,
          readinessScore: readiness.score,
          ready: readiness.ready,
          // Feed the blockers back so the agent knows what to ask about next
          // without having to re-derive the rubric from the document.
          blockers: readiness.blockers,
        },
        summary: input?.changeSummary
          ? `PRD updated: ${input.changeSummary}`
          : `PRD updated (${ops.length} change(s))`,
        events: [
          {
            event: 'prd_draft',
            data: { draft: doc.draft, versionNumber: doc.versionNumber },
          },
          {
            event: 'readiness',
            data: readiness as unknown as Record<string, any>,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `update_prd failed for session ${context.session.id}: ${message}`,
      );
      return {
        modelResult: {
          ok: false,
          error: 'patch_failed',
          message,
          hint: 'Re-read the PRD structure and retry with corrected paths.',
        },
        summary: `PRD patch rejected: ${message}`,
      };
    }
  }
}
