import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { BuilderBuildService } from '../service/builder-build.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderCatalogService } from '../service/builder-catalog.service';
import { BuilderEvidenceLogService } from '../service/builder-evidence-log.service';
import { renderPrd } from '../constants/builder-build-prompt';
import { renderPlatformRules } from '../constants/builder-platform-rules';
import {
  buildDesignPrompt,
  buildDesignReviewPrompt,
} from '../constants/builder-design-prompt';
import {
  computeDesignReadiness,
  sliceDesignForRepos,
} from '../util/builder-technical-design.util';
import { BuilderTechnicalDesign } from '../type/builder-prd.type';
import { BuilderCatalogEntry } from '../entity/builder-repo-catalog.entity';
import { BUILDER_EVENT_BATCH_MAX } from '../constants/builder.constants';
import {
  BUILDER_REPOS,
  BuilderRepoDefinition,
  findBuilderRepo,
} from '../constants/builder-repos.constants';
import {
  BuilderPrdVersionAuthor,
  BuilderRunMode,
  BuilderRunStatus,
} from '../enum/builder.enum';
import {
  IngestBuilderEventsDto,
  RecordBuilderRunCostDto,
  CompleteBuilderRunDto,
  UpsertBuilderRepoCatalogDto,
  UpsertBuilderRepoMapDto,
  RecordBuilderReviewFindingsDto,
  SubmitBuilderDesignDto,
  SubmitBuilderDesignReviewDto,
  RecordBuilderUsageDto,
} from '../dto/builder-pipeline.dto';

/**
 * The machine-facing half of Builder: what a GitHub Actions runner calls back
 * into while a build is in flight.
 *
 * A separate controller class from the admin one, deliberately — these routes
 * authenticate with a shared API key rather than a user's JWT, and the two
 * auth models must never end up on one route table by accident.
 *
 * Two kinds of caller: Builder's own runner, which now only drafts technical
 * designs (builder-session.yml), and the opencode workflows in each repo,
 * which fetch an issue build's spec, a fix request's feedback, file a review
 * and report spend. The design protocol is served from here rather than baked
 * into the workflow file, so a change takes effect on the next dispatch
 * instead of after a PR merges.
 */
@ApiTags('Builder pipeline (machine)')
@ApiSecurity('x-api-key')
@UseGuards(ApiAuthGuard)
@Controller({ path: 'builder/pipeline', version: '1' })
export class BuilderPipelineController {
  constructor(
    private readonly buildService: BuilderBuildService,
    private readonly eventService: BuilderEventService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly prdService: BuilderPrdService,
    private readonly sessionService: BuilderSessionService,
    private readonly catalogService: BuilderCatalogService,
    private readonly evidenceLog: BuilderEvidenceLogService,
  ) {}

  /**
   * Run + session + PRD + repo definitions, which every prompt and spec
   * needs. One loader so no endpoint resolves repos differently from the
   * others.
   */
  private async loadRunContext(runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);
    const stored = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    // A run built for some of the session's repos (one repo per build) is
    // served the PRD, design and repo list for those repos only. Older runs
    // recorded none and read the session's, as they always did.
    const runRepos = run.repos?.length ? run.repos : (session.repos ?? []);
    const doc = run.repos?.length
      ? { ...stored, draft: sliceDesignForRepos(stored.draft, run.repos) }
      : stored;
    const repos = runRepos
      .map((repo) => findBuilderRepo(repo))
      .filter(Boolean) as typeof BUILDER_REPOS;
    return { run, session, doc, repos };
  }

  @Get('runs/:runId/prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The design protocol for this run, rendered server-side',
  })
  async getPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const { run, session, doc, repos } = await this.loadRunContext(runId);
    const platformRules = await this.knowledgeService.platformRules();

    // Only design runs go to Builder's runner. A design run writes the
    // technical design and nothing else: read-only, every target repo checked
    // out, and its output goes through the `design` tool rather than a branch.
    if (run.mode === BuilderRunMode.DESIGN) {
      return buildDesignPrompt({
        platformRules,
        sessionId: session.id,
        runId: run.id,
        prd: doc.draft,
        repos,
        repoPacks: await this.knowledgeService.renderRepoPacks(
          session.repos ?? undefined,
        ),
        interviewEvidence: await this.evidenceLog.renderForPrompt(session.id),
      });
    }

    throw new BadRequestException(
      `Run ${runId} is a ${run.mode} run. Builder's runner only drafts ` +
        'technical designs now; a build runs as an issue in its repo.',
    );
  }

  @Post('runs/:runId/review')
  @ApiOperation({
    summary: 'What a review run found on the pull request it read',
  })
  async recordReviewFindings(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderReviewFindingsDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const recorded = await this.pullRequestService.recordReviewFindings(
      run.id,
      run.sessionId,
      dto.pullRequestId,
      dto.findings ?? [],
    );
    // An in-repo review reports nothing else: its verdict is its end.
    if (this.buildService.isRepoReview(run)) {
      await this.buildService.settleRepoReview(
        run,
        BuilderRunStatus.SUCCEEDED,
        null,
      );
    }
    return { ok: true, recorded };
  }

  @Post('runs/:runId/events')
  @ApiOperation({ summary: 'Append a batch of build events' })
  async ingestEvents(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: IngestBuilderEventsDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    if (dto.events.length > BUILDER_EVENT_BATCH_MAX) {
      throw new BadRequestException(
        `At most ${BUILDER_EVENT_BATCH_MAX} events per batch.`,
      );
    }
    const saved = await this.eventService.ingest(run, dto.events);
    return {
      accepted: saved.length,
      lastSeq: saved[saved.length - 1]?.seq ?? null,
    };
  }

  @Post('runs/:runId/cost')
  @ApiOperation({ summary: 'Report token usage and cost for this run' })
  async recordCost(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderRunCostDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    await this.buildService.recordRunCost(run, dto);
    return { ok: true };
  }

  @Post('runs/:runId/complete')
  @ApiOperation({ summary: 'Finish the run' })
  async complete(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: CompleteBuilderRunDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);

    // A design run's evidence is the design itself: a `done` with no
    // submission from this run is refused, because the claim is not checkable
    // any other way.
    if (run.mode === BuilderRunMode.DESIGN) {
      if (dto.outcome === 'done') {
        const doc = await this.prdService.getOrCreateDoc(
          session.id,
          session.createdBy,
        );
        const design = doc.draft.technicalDesign;
        if (!design || design.runId !== run.id || design.status !== 'review') {
          throw new ConflictException(
            'No design submitted from this run. Call `design` with the full ' +
              'design first; the run is done once it has accepted one.',
          );
        }
      }
      await this.buildService.settleRun(
        run,
        dto.outcome === 'done'
          ? BuilderRunStatus.SUCCEEDED
          : BuilderRunStatus.FAILED,
        dto.outcome === 'done' ? null : (dto.error ?? 'The design run failed.'),
      );
      return { ok: true };
    }

    // Any other run reaching here is one the runner's outcome gate is
    // settling after its engine exited (outcome-gate.sh). Builder's runner no
    // longer builds — a build is an issue in its repo, and its pull request is
    // its outcome — so only a failure is accepted: there is nothing a `done`
    // from the runner could be checked against.
    if (dto.outcome === 'done') {
      throw new ConflictException(
        `Run ${run.id} is a ${run.mode} run. Only a design run reports done ` +
          'here; a build is settled from its issue and pull request.',
      );
    }
    await this.buildService.settleRun(
      run,
      BuilderRunStatus.FAILED,
      dto.error ?? 'The run failed.',
    );
    return { ok: true };
  }

  /**
   * The design run for this session, and the design it is drafting.
   *
   * Refuses anything else: a design is only ever written by the run the
   * drafting record names, so a stale designer from a superseded draft — or
   * a build run calling the wrong tool — cannot overwrite the current one.
   */
  private async loadDesignRun(runId: string) {
    const context = await this.loadRunContext(runId);
    if (context.run.mode !== BuilderRunMode.DESIGN) {
      throw new BadRequestException(
        `Run ${runId} is a ${context.run.mode} run, not a design run.`,
      );
    }
    const design = context.doc.draft.technicalDesign;
    if (!design || design.runId !== context.run.id) {
      throw new ConflictException(
        'This run is not the one drafting the current technical design — a ' +
          'newer draft has replaced it. Stop.',
      );
    }
    return { ...context, design };
  }

  /**
   * What an issue build is building, and nothing about how: the platform
   * rules, what the repo's CI checks, and the PRD with its approved technical
   * design, cut to the run's repo. Fetched by the repo's builder.yml workflow
   * (the issue carries only the run id) and by the in-repo review.
   */
  @Get('runs/:runId/spec')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary:
      'The spec an issue build works from: rules, CI checks, PRD, approved design',
  })
  async getSpec(@Param('runId', ParseUUIDPipe) runId: string): Promise<string> {
    const { doc, repos } = await this.loadRunContext(runId);
    const platformRules = await this.knowledgeService.platformRules();
    return [
      renderPlatformRules(platformRules),
      renderRepoChecks(repos),
      renderPrd(doc.draft),
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  /**
   * The feedback a `/oc` fix request hands opencode on one of its pull
   * requests. Fetched by builder-opencode.yml when the `/oc` comment carries
   * Builder's `builder-feedback` marker, so findings never appear in a public
   * repo's comments (BuilderPullRequestService.considerOpencodeFix).
   */
  @Get('pull-requests/:pullRequestId/fix-request')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary:
      'The feedback an outstanding /oc fix request asks opencode to address',
  })
  async getFixRequest(
    @Param('pullRequestId', ParseUUIDPipe) pullRequestId: string,
  ): Promise<string> {
    return this.pullRequestService.fixRequestPrompt(pullRequestId);
  }

  @Get('runs/:runId/design-review-prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The cold critique of a submitted technical design (read-only)',
  })
  async getDesignReviewPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const { run, session, doc, repos, design } =
      await this.loadDesignRun(runId);
    return buildDesignReviewPrompt({
      platformRules: await this.knowledgeService.platformRules(),
      sessionId: session.id,
      runId: run.id,
      prd: doc.draft,
      repos,
      design,
    });
  }

  /**
   * The designer's submission, behind the `design` MCP tool.
   *
   * Answers with what still blocks approval rather than a bare ok, because
   * the designer is the one reader able to fix most of it, in this same run.
   * The "not in review" blocker is left out — this call is what puts it there.
   */
  @Post('runs/:runId/design')
  @ApiOperation({
    summary: 'Submit the technical design; returns what still blocks approval',
  })
  async submitDesign(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: SubmitBuilderDesignDto,
  ) {
    const { run, session, doc, design } = await this.loadDesignRun(runId);
    if (design.status === 'approved') {
      throw new ConflictException(
        'This technical design is already approved; it cannot be resubmitted.',
      );
    }

    // Fields picked one by one, not spread: the body is model-written and
    // the global pipe does not strip unknown keys.
    const next: BuilderTechnicalDesign = {
      ...design,
      status: 'review',
      designMd: dto.designMd,
      scope: dto.scope.map((entry) => ({
        repo: entry.repo.trim(),
        files: entry.files.map((file) => file.trim()).filter(Boolean),
      })),
      contracts: dto.contracts.map((contract) => ({
        name: contract.name,
        change: contract.change,
        readers: contract.readers
          .map((reader) => reader.trim())
          .filter(Boolean),
      })),
      compatibilityMd: dto.compatibilityMd,
      testMap: dto.testMap.map((test) => ({
        requirementId: test.requirementId.trim(),
        repo: test.repo,
        file: test.file,
        asserts: test.asserts,
      })),
      openDecisions: dto.openDecisions
        .map((decision) => decision.trim())
        .filter(Boolean),
      draftedAt: new Date().toISOString(),
      error: null,
    };
    const { doc: saved } = await this.prdService.setTechnicalDesign(
      doc,
      next,
      session.createdBy ?? 0,
      BuilderPrdVersionAuthor.AGENT,
      `Technical design submitted by run ${run.id}`,
    );

    const readiness = computeDesignReadiness(saved.draft, {
      ignoreStatus: true,
    });
    return { ok: true, blockers: readiness.blockers };
  }

  @Post('runs/:runId/design-review')
  @ApiOperation({
    summary: "The critic's verdict on the submitted technical design",
  })
  async submitDesignReview(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: SubmitBuilderDesignReviewDto,
  ) {
    const { run, session, doc, design } = await this.loadDesignRun(runId);
    if (design.status !== 'review') {
      throw new ConflictException(
        `There is no submitted design to review — it is ${design.status}.`,
      );
    }
    // The verdict follows the defects when they are sent, rather than the
    // reviewer's own word: see BuilderDesignReview. A runner from before the
    // split sends only a verdict and notes, which still stand as they are.
    const defects = dto.defects?.map((item) => item.trim()).filter(Boolean);
    const suggestions = dto.suggestions
      ?.map((item) => item.trim())
      .filter(Boolean);
    const verdict: 'pass' | 'concerns' = defects
      ? defects.length
        ? 'concerns'
        : 'pass'
      : (dto.verdict ?? 'pass');
    await this.prdService.setTechnicalDesign(
      doc,
      {
        ...design,
        review: {
          verdict,
          notesMd: dto.notesMd ?? '',
          ...(defects ? { defects } : {}),
          ...(suggestions ? { suggestions } : {}),
          at: new Date().toISOString(),
        },
      },
      session.createdBy ?? 0,
      BuilderPrdVersionAuthor.AGENT,
      `Technical design reviewed by run ${run.id}: ${verdict}`,
    );
    return { ok: true };
  }

  /** The platform rules on their own, for anything on the runner that wants them. */
  @Get('platform-rules')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'The standing platform rules every agent gets' })
  getPlatformRules(): Promise<string> {
    return this.knowledgeService.platformRules();
  }

  /**
   * What the run looks like from the outside, for the workflow's own
   * outcome gate to read after the engine exits.
   *
   * `claude -p` exits 0 whenever the agent produces a final response — including
   * when it ends its turn mid-protocol. That makes "stopped without reporting"
   * indistinguishable from success at the workflow level, so the workflow asks
   * here instead of trusting its own exit code.
   */
  @Get('runs/:runId/status')
  @ApiOperation({
    summary: 'Run status, stage and PR count, for the runner outcome gate',
  })
  async getRunStatus(@Param('runId', ParseUUIDPipe) runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    const pullRequests = await this.pullRequestService.listBySession(
      run.sessionId,
    );
    return {
      runId: run.id,
      status: run.status,
      pullRequestCount: pullRequests.filter((pr) => pr.runId === run.id).length,
    };
  }

  /**
   * What an opencode build or fix, or an in-repo review, spent. Posted by the
   * Builder workflows when they finish; best-effort on their side.
   */
  @Post('usage')
  @ApiOperation({
    summary: 'Record what an opencode run or a review spent (tokens, USD)',
  })
  recordUsage(@Body() dto: RecordBuilderUsageDto) {
    return this.pullRequestService.recordUsage(dto);
  }

  @Post('repo-maps')
  @ApiOperation({
    summary: 'Upsert a Repo Knowledge Pack (context-refresh workflow)',
  })
  async upsertRepoMap(@Body() dto: UpsertBuilderRepoMapDto) {
    const map = await this.knowledgeService.upsertRepoMap({
      repo: dto.repo,
      mapMd: dto.mapMd,
      commitSha: dto.commitSha ?? null,
      stats: dto.stats ?? null,
    });
    return { ok: true, repo: map.repo, generatedAt: map.generatedAt };
  }

  @Post('repo-catalogs')
  @ApiOperation({
    summary: "Replace a repo's capability catalog (context-refresh workflow)",
  })
  async upsertRepoCatalog(@Body() dto: UpsertBuilderRepoCatalogDto) {
    const catalog = await this.catalogService.upsert({
      repo: dto.repo,
      commitSha: dto.commitSha ?? null,
      entries: normaliseCatalogEntries(dto.entries),
      stats: dto.stats ?? null,
    });
    return {
      ok: true,
      repo: catalog.repo,
      entries: catalog.entries.length,
      generatedAt: catalog.generatedAt,
    };
  }
}

/**
 * Keep only the declared keys of each catalog entry, as strings, and drop any
 * entry without a kind and a name. The extractor is ours, but this endpoint is
 * reachable by anything holding the pipeline key.
 */
function normaliseCatalogEntries(
  entries: Record<string, any>[],
): BuilderCatalogEntry[] {
  const out: BuilderCatalogEntry[] = [];
  for (const entry of entries ?? []) {
    const kind = typeof entry?.kind === 'string' ? entry.kind.slice(0, 40) : '';
    const name =
      typeof entry?.name === 'string' ? entry.name.slice(0, 300) : '';
    if (!kind || !name) continue;
    out.push({
      kind,
      name,
      path: typeof entry.path === 'string' ? entry.path.slice(0, 400) : '',
      ...(typeof entry.detail === 'string'
        ? { detail: entry.detail.slice(0, 300) }
        : {}),
      ...(typeof entry.app === 'string' ? { app: entry.app.slice(0, 80) } : {}),
    });
  }
  return out;
}

/**
 * What this repository's CI will hold the pull request to, so a build runs the
 * same commands before it finishes instead of learning them from a red check,
 * and the docs rule its docs-guard enforces — a rule no fix run can satisfy
 * after the fact, because it needs a line in the PR description.
 */
export function renderRepoChecks(repos: BuilderRepoDefinition[]): string {
  if (!repos.length) return '';
  const lines = ['## What CI checks in this repository', ''];
  for (const repo of repos) {
    const commands = [
      repo.typecheck,
      repo.lint,
      ...(repo.ciChecks ?? []),
      repo.affectedTest ?? repo.test,
    ].filter(Boolean);
    lines.push(`${repo.repo}: ${commands.map((c) => `\`${c}\``).join(', ')}`);
  }
  lines.push(
    '',
    'Run these before you finish and fix what they report. Formatting of the files you changed is applied for you afterwards.',
    '',
    'Docs: if `.docs-map.yml` exists, a file you change may map to a doc. Update a mapped doc inside this repository when your change makes it wrong. For a mapped wiki page, end your summary with one line: `Wiki-PR: none — <why the page stays accurate>` or `Wiki-PR: needed — <what the page must now say>`.',
  );
  return lines.join('\n');
}
