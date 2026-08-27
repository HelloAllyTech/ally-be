import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderExemplar } from '../entity/builder-exemplar.entity';
import { BuilderExemplarRepository } from '../repository/builder-knowledge.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderPrFeedbackRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import { BuilderPrdDocRepository } from '../repository/builder-prd.repository';
import {
  BuilderEventType,
  BuilderExemplarOutcome,
  BuilderPrFeedbackKind,
} from '../enum/builder.enum';
import {
  BUILDER_EXEMPLARS_IN_CONTEXT,
  BUILDER_EXEMPLAR_CANDIDATES,
} from '../constants/builder.constants';

/**
 * The exemplar bank: finished builds, archived with how they actually turned
 * out, so a new session can be told "something like this was tried before, and
 * here is what happened".
 *
 * Lessons capture what an agent believed it had learned in the minutes after
 * finishing — the worst moment to judge whether the work was any good. Whether
 * the pull request merged, was closed unmerged, needed four fix runs or drew
 * eleven review comments is knowable only later, and it is the part that says
 * which approaches actually work here.
 */
@Injectable()
export class BuilderExemplarService {
  private readonly logger = LoggerService.getInstance(
    BuilderExemplarService.name,
  );

  // Exposed for tests (mocked with a fake client), matching the orchestrator.
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly repository: BuilderExemplarRepository,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly eventRepository: BuilderBuildEventRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly feedbackRepository: BuilderPrFeedbackRepository,
    private readonly docRepository: BuilderPrdDocRepository,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * Archive a session once it reaches a terminal state.
   *
   * Idempotent: called from run settling, which can happen more than once for
   * one session (a retry, a reconcile catching up), and re-archiving would
   * throw away the outcome the pipeline has since learned.
   */
  async archiveSession(sessionId: string): Promise<BuilderExemplar | null> {
    const existing = await this.repository.findBySession(sessionId);
    if (existing) return existing;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) return null;

    const [runs, pullRequests, doc] = await Promise.all([
      this.runRepository.listBySession(sessionId),
      this.pullRequestRepository.listBySession(sessionId),
      this.docRepository.findOne({ where: { sessionId } }),
    ]);

    const planMd = await this.findPlan(runs.map((run) => run.id));
    const outcome = this.deriveOutcome(session.status, pullRequests);
    const facts = {
      title: session.title,
      repos: session.repos ?? null,
      prdSnapshot: doc?.draft ?? null,
      planMd,
      diffstat: await this.deriveDiffstat(runs.map((run) => run.id)),
      outcome,
      fixRunCount: pullRequests.reduce(
        (sum, pr) => sum + (pr.fixRunCount ?? 0),
        0,
      ),
      costUsd: session.totalCostUsd ?? null,
      runnerMinutes: session.runnerMinutes ?? null,
    };

    const exemplar = await this.repository.save(
      this.repository.create({
        sessionId,
        ...facts,
        summaryMd: await this.writeSummary(facts),
        lastOutcomeSyncAt: new Date(),
      }),
    );
    this.logger.info(
      `Archived Builder session ${sessionId} as an exemplar (${outcome}).`,
    );
    return exemplar;
  }

  /**
   * Re-read the outcome of an already-archived build.
   *
   * The interesting half of an exemplar's life happens after it is written: a
   * PR merges a week later, or is closed without a word. Called from the
   * outcome sweep rather than on a timer of its own.
   */
  async refreshOutcome(sessionId: string): Promise<void> {
    const exemplar = await this.repository.findBySession(sessionId);
    if (!exemplar) return;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    const pullRequests =
      await this.pullRequestRepository.listBySession(sessionId);
    const feedback = await this.feedbackRepository.listBySession(sessionId);

    const outcome = this.deriveOutcome(session?.status, pullRequests);
    const merged = pullRequests.filter((pr) => pr.merged && pr.mergedAt);
    const timeToMergeHours = merged.length
      ? (
          merged.reduce(
            (max, pr) =>
              Math.max(
                max,
                (pr.mergedAt!.getTime() - exemplar.createdAt.getTime()) /
                  3_600_000,
              ),
            0,
          ) || 0
        ).toFixed(2)
      : null;

    const changed = outcome !== exemplar.outcome;
    await this.repository.update(
      { id: exemplar.id },
      {
        outcome,
        fixRunCount: pullRequests.reduce(
          (sum, pr) => sum + (pr.fixRunCount ?? 0),
          0,
        ),
        reviewCommentCount: feedback.filter(
          (item) => item.kind === BuilderPrFeedbackKind.REVIEW_COMMENT,
        ).length,
        ciFailureCount: feedback.filter(
          (item) => item.kind === BuilderPrFeedbackKind.CI_FAILURE,
        ).length,
        costUsd: session?.totalCostUsd ?? exemplar.costUsd ?? null,
        runnerMinutes: session?.runnerMinutes ?? exemplar.runnerMinutes ?? null,
        timeToMergeHours,
        lastOutcomeSyncAt: new Date(),
      },
    );

    // The digest names the outcome, so a flip makes the old wording wrong.
    // Only then is it worth another model call.
    if (changed) {
      const refreshed = await this.repository.findBySession(sessionId);
      if (refreshed) {
        await this.repository.update(
          { id: refreshed.id },
          { summaryMd: await this.writeSummary(refreshed) },
        );
      }
    }
  }

  /** Archived builds whose outcome may still change — what the sweep walks. */
  listUnsettled(): Promise<BuilderExemplar[]> {
    return this.repository.listUnsettled();
  }

  /** The archive, newest first — what the knowledge page renders. */
  listRecent(limit = 100): Promise<BuilderExemplar[]> {
    return this.repository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findBySession(sessionId: string): Promise<BuilderExemplar | null> {
    return this.repository.findBySession(sessionId);
  }

  /** Record which failure categories a build earned. */
  async recordFailureTags(sessionId: string, tags: string[]): Promise<void> {
    const exemplar = await this.repository.findBySession(sessionId);
    if (!exemplar || !tags.length) return;
    const merged = [...new Set([...(exemplar.failureTags ?? []), ...tags])];
    await this.repository.update(
      { id: exemplar.id },
      { failureTags: merged as BuilderExemplar['failureTags'] },
    );
  }

  /**
   * The past builds most worth showing a new session, as rendered digests.
   *
   * Candidates come from the repos in play; the pick is a cheap model call
   * rather than an index, because "similar" here means similar *work*, which
   * keyword overlap models badly — two builds can share every noun and be
   * nothing alike. With a bounded candidate list a re-rank is affordable and
   * strictly better.
   */
  async selectForContext(
    query: string,
    repos: string[] | undefined,
    limit: number,
  ): Promise<string[]> {
    const candidates = await this.repository.listCandidates(
      BUILDER_EXEMPLAR_CANDIDATES,
      repos,
    );
    if (!candidates.length) return [];
    if (candidates.length <= limit) {
      return candidates.map((exemplar) => this.render(exemplar));
    }

    const picked = await this.rank(query, candidates, limit);
    return picked.map((exemplar) => this.render(exemplar));
  }

  /**
   * The digests for a session, choosing them once and reusing that choice.
   *
   * The choice is frozen on the session because the context block it lands in
   * is inside the prompt-cached prefix — a selection that varied per turn would
   * bust the cache every turn, which costs more than the exemplars are worth.
   * Re-picked only when the repo set changes, because that is what makes a
   * different past build relevant.
   */
  async digestsForSession(session: {
    id: string;
    title: string;
    repos?: string[] | null;
    contextExemplarIds?: string[] | null;
    contextExemplarRepos?: string[] | null;
  }): Promise<{ digests: string[]; chosen: string[] | null }> {
    const repos = session.repos ?? [];
    const sameScope =
      JSON.stringify([...(session.contextExemplarRepos ?? [])].sort()) ===
      JSON.stringify([...repos].sort());

    if (session.contextExemplarIds && sameScope) {
      const frozen = await this.repository.findByIds(
        session.contextExemplarIds,
      );
      return { digests: frozen.map((item) => this.render(item)), chosen: null };
    }

    const candidates = await this.repository.listCandidates(
      BUILDER_EXEMPLAR_CANDIDATES,
      repos.length ? repos : undefined,
    );
    if (!candidates.length) return { digests: [], chosen: [] };

    const picked =
      candidates.length <= BUILDER_EXEMPLARS_IN_CONTEXT
        ? candidates
        : await this.rank(
            session.title,
            candidates,
            BUILDER_EXEMPLARS_IN_CONTEXT,
          );

    return {
      digests: picked.map((item) => this.render(item)),
      chosen: picked.map((item) => item.id),
    };
  }

  private async rank(
    query: string,
    candidates: BuilderExemplar[],
    limit: number,
  ): Promise<BuilderExemplar[]> {
    const model = this.configService.builder.mechanicalModel;
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 512,
        system:
          'You pick which past builds are worth showing an engineer starting a ' +
          'new one. Relevant means the work overlaps — same subsystem, same ' +
          'kind of change, same trap — not merely the same words. Reply with ' +
          'a JSON array of ids, most relevant first, and nothing else.',
        messages: [
          {
            role: 'user',
            content: [
              `## The new work\n${query}`,
              '',
              '## Past builds',
              ...candidates.map(
                (exemplar) =>
                  `- [${exemplar.id}] ${exemplar.title} (${exemplar.outcome}${
                    exemplar.repos?.length
                      ? `, ${exemplar.repos.join('/')}`
                      : ''
                  })`,
              ),
              '',
              `Pick at most ${limit}.`,
            ].join('\n'),
          },
        ],
      });

      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model,
        task: LlmTask.BUILDER_CONTEXT_SELECTION,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        metadata: { kind: 'exemplars', candidates: candidates.length },
      });

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      const ids = parseIdList(text);
      const byId = new Map(candidates.map((item) => [item.id, item]));
      const picked = ids
        .map((id) => byId.get(id))
        .filter(Boolean) as BuilderExemplar[];
      if (picked.length) return picked.slice(0, limit);
    } catch (error) {
      this.logger.warn(
        `Exemplar re-rank failed, falling back to most recent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Deterministic fallback — never return nothing because a ranking call
    // failed. Recent-and-merged is a reasonable second-best.
    return [...candidates]
      .sort(
        (a, b) =>
          Number(b.outcome === 'merged') - Number(a.outcome === 'merged'),
      )
      .slice(0, limit);
  }

  private render(exemplar: BuilderExemplar): string {
    const facts = [
      exemplar.repos?.length ? exemplar.repos.join(', ') : null,
      `outcome: ${exemplar.outcome}`,
      exemplar.fixRunCount
        ? `${exemplar.fixRunCount} fix run(s) afterwards`
        : null,
      exemplar.reviewCommentCount
        ? `${exemplar.reviewCommentCount} review comment(s)`
        : null,
      exemplar.failureTags?.length
        ? `tags: ${exemplar.failureTags.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return `**${exemplar.title}** (${facts})\n${
      exemplar.summaryMd ?? '(no summary written)'
    }`;
  }

  /**
   * A short digest of the build, which is what a prompt actually receives.
   *
   * The facts come from ally-be, not from the model: run outcomes, spend and
   * merge state are things we already know, and asking a model to restate them
   * is a way to get them wrong. What the model is for is compression.
   */
  private async writeSummary(facts: {
    title: string;
    repos?: string[] | null;
    outcome: string;
    prdSnapshot?: Record<string, any> | null;
    planMd?: string | null;
    fixRunCount?: number;
    reviewCommentCount?: number;
    failureTags?: string[] | null;
  }): Promise<string | null> {
    const model = this.configService.builder.mechanicalModel;
    const prd = facts.prdSnapshot ?? {};
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 600,
        system:
          'You write a 120-150 word note about a finished software build, for ' +
          'an agent about to attempt something similar. Cover: what was asked, ' +
          'the approach taken, and what happened after it shipped. Be concrete ' +
          'about the approach — subsystems, files, techniques. If the work was ' +
          'rejected or needed rework, say plainly what went wrong; that is the ' +
          'most useful sentence in the note. Plain prose, no headings.',
        messages: [
          {
            role: 'user',
            content: [
              `Title: ${facts.title}`,
              `Repos: ${facts.repos?.join(', ') ?? 'unknown'}`,
              `Outcome: ${facts.outcome}`,
              facts.fixRunCount
                ? `Fix runs needed afterwards: ${facts.fixRunCount}`
                : '',
              facts.reviewCommentCount
                ? `Review comments received: ${facts.reviewCommentCount}`
                : '',
              facts.failureTags?.length
                ? `Failure tags: ${facts.failureTags.join(', ')}`
                : '',
              '',
              `Summary from the PRD: ${String(prd.summary ?? '(none)')}`,
              `Problem: ${String(prd.problem ?? '(none)')}`,
              facts.planMd ? `\nPlan:\n${facts.planMd.slice(0, 4000)}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });

      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model,
        task: LlmTask.BUILDER_CONTEXT_SELECTION,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        metadata: { kind: 'exemplar_summary' },
      });

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
        .trim();
      return text || null;
    } catch (error) {
      this.logger.warn(
        `Could not summarise an exemplar; storing the facts without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private deriveOutcome(
    sessionStatus: string | undefined,
    pullRequests: { merged: boolean; state?: string | null }[],
  ): BuilderExemplarOutcome {
    if (!pullRequests.length) {
      if (sessionStatus === 'CANCELLED')
        return BuilderExemplarOutcome.CANCELLED;
      if (sessionStatus === 'FAILED') return BuilderExemplarOutcome.FAILED;
      return BuilderExemplarOutcome.OPEN;
    }
    const merged = pullRequests.filter((pr) => pr.merged).length;
    if (merged === pullRequests.length) return BuilderExemplarOutcome.MERGED;
    if (merged) return BuilderExemplarOutcome.PARTIALLY_MERGED;

    // Every PR closed and none merged: the work was rejected. This is the
    // distinction the schema could not previously express, and the most
    // informative outcome there is.
    const allClosed = pullRequests.every((pr) => pr.state === 'closed');
    if (allClosed) return BuilderExemplarOutcome.CLOSED_UNMERGED;
    return BuilderExemplarOutcome.OPEN;
  }

  /** The plan the planner pass wrote, read back off the event log. */
  private async findPlan(runIds: string[]): Promise<string | null> {
    for (const runId of runIds) {
      const events = await this.eventRepository.listByRun(runId, 0, 500);
      const plan = events.find((event) => event.type === BuilderEventType.PLAN);
      if (plan?.payload?.text) return String(plan.payload.text);
    }
    return null;
  }

  /** Files touched per repo, from the file_edit events. */
  private async deriveDiffstat(
    runIds: string[],
  ): Promise<Record<string, any> | null> {
    const perRepo = new Map<string, Set<string>>();
    for (const runId of runIds) {
      const events = await this.eventRepository.listByRun(runId, 0, 2000);
      for (const event of events) {
        if (event.type !== BuilderEventType.FILE_EDIT) continue;
        const path = String(event.payload?.path ?? '');
        if (!path) continue;
        // Paths arrive as `repos/<repo>/...` from inside the runner.
        const match = path.match(/repos\/([^/]+)\/(.+)/);
        const repo = match?.[1] ?? 'unknown';
        const file = match?.[2] ?? path;
        if (!perRepo.has(repo)) perRepo.set(repo, new Set());
        perRepo.get(repo)!.add(file);
      }
    }
    if (!perRepo.size) return null;
    return Object.fromEntries(
      [...perRepo.entries()].map(([repo, files]) => [
        repo,
        { filesChanged: files.size },
      ]),
    );
  }
}

/** Ids out of a model's reply, tolerant of fences and prose around them. */
export function parseIdList(text: string): string[] {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  for (const raw of [...blocks, text]) {
    const start = raw.indexOf('[');
    if (start === -1) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1));
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry)).filter(Boolean);
      }
    } catch {
      continue;
    }
  }
  return [];
}
