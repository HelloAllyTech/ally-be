import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_HUNT_SWEEP_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { clipDossierText } from '../constants/bug-fix-dossier';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus, BugHunterMode } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';
import { BugFindingVerdict } from '../type/bug-finding-verdict.type';
import {
  BUG_HUNT_PR_REVIEW_MAX_AGE_MS,
  BUG_HUNT_PR_REVIEW_MAX_DISPATCH_PER_POLL,
  BUG_HUNT_PR_REVIEW_SKIP_AUTHORS,
  BugFindingPrRef,
  PrReviewTarget,
} from '../type/bug-hunter-pr-review.type';
import { BugFindingService } from './bug-finding.service';
import { BugHunterService } from './bug-hunter.service';

/**
 * The PR review sense — OPP-0785. See `bug-hunter-pr-review.type.ts`.
 *
 * Two halves. `poll` runs every five minutes and starts one `pr_review`
 * run per open pull request head it has not seen, on every fixable repo,
 * skipping Bug Hunter's own and the bots'. `commentForFinding` is what the
 * orchestrator calls when the independent Verifier confirms a finding that
 * carries a PR link: it writes the review comment on the PR, with the
 * finding and the Verifier's reproduction, and holds the finding for a
 * person rather than starting a fix session — the PR's author owns the
 * change.
 */
@Injectable()
export class BugHunterPrReviewService {
  private readonly logger = LoggerService.getInstance(
    BugHunterPrReviewService.name,
  );

  constructor(
    private readonly github: GithubActionsService,
    private readonly bugHunterService: BugHunterService,
    private readonly bugFindingService: BugFindingService,
    private readonly runRepository: BugHuntRunRepository,
    private readonly findingRepository: BugFindingRepository,
    private readonly configService: AppConfigService,
  ) {}

  /** One review run per unseen open PR head, per fixable repo; nothing while Bug Hunter is off. */
  async poll(): Promise<number> {
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode === BugHunterMode.OFF) return 0;
    let dispatched = 0;
    for (const [repo, config] of Object.entries(BUG_HUNT_REPOS)) {
      if (!config.fixable) continue;
      try {
        dispatched += await this.pollRepo(repo);
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] PR review poll failed for ${repo}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return dispatched;
  }

  private async pollRepo(repo: string): Promise<number> {
    const prs = await this.github.listPullRequests(repo);
    if (!prs) return 0;
    const since = Date.now() - BUG_HUNT_PR_REVIEW_MAX_AGE_MS;
    const candidates = prs.filter(
      (pr) =>
        pr.number != null &&
        pr.headSha &&
        !pr.draft &&
        !BUG_HUNT_PR_REVIEW_SKIP_AUTHORS.includes(pr.authorLogin ?? '') &&
        (pr.updatedAt?.getTime() ?? 0) >= since,
    );
    if (!candidates.length) return 0;

    const seen = await this.reviewedHeads(repo);
    let dispatched = 0;
    for (const pr of candidates) {
      if (dispatched >= BUG_HUNT_PR_REVIEW_MAX_DISPATCH_PER_POLL) break;
      if (seen.has(`${pr.number}:${pr.headSha}`)) continue;
      if (await this.dispatch(repo, pr)) dispatched += 1;
    }
    return dispatched;
  }

  /** Every PR head a review run has already been opened for on this repo, running or finished. */
  private async reviewedHeads(repo: string): Promise<Set<string>> {
    const runs = await this.runRepository.find({
      where: { repo, trigger: BugHuntTrigger.PR_REVIEW },
      order: { createdAt: 'DESC' },
      take: 300,
    });
    const out = new Set<string>();
    for (const run of runs) {
      const target = run.metadata?.prReview as PrReviewTarget | undefined;
      if (target?.number != null && target.headSha)
        out.add(`${target.number}:${target.headSha}`);
    }
    return out;
  }

  private async dispatch(
    repo: string,
    pr: {
      number: number | null;
      htmlUrl: string;
      headSha: string | null;
      baseRef: string | null;
      authorLogin: string | null;
      title: string | null;
      body: string | null;
    },
  ): Promise<boolean> {
    const target: PrReviewTarget = {
      number: pr.number!,
      url: pr.htmlUrl,
      headSha: pr.headSha!,
      baseRef: pr.baseRef ?? 'master',
      author: pr.authorLogin ?? 'unknown',
      title: pr.title ?? `#${pr.number}`,
      body: pr.body,
    };
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.PR_REVIEW,
      repo,
    );
    await this.bugHunterService.setRunMetadata(run.id, { prReview: target });
    try {
      await this.github.dispatchWorkflow({
        repo,
        workflow: BUG_HUNT_SWEEP_WORKFLOW_FILE,
        ref: BUG_FIX_SESSION_DEFAULT_REF,
        inputs: {
          run_id: run.id,
          repo,
          deep: 'false',
          api_base_url: this.configService.publicApiBaseUrl,
          mode: 'pr_review',
          pr_number: String(target.number),
        },
      });
    } catch (error) {
      await this.bugHunterService.closeRun(
        run.id,
        BugHuntRunStatus.FAILED,
        {
          foundCount: 0,
          autoMergedCount: 0,
          prOpenedCount: 0,
          dismissedCount: 0,
        },
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
    await this.bugHunterService.appendEvent({
      runId: run.id,
      repo,
      stage: BugHuntEventStage.FINDER_RESULT,
      summary: `Reviewing ${target.url} (#${target.number} by ${target.author}, head ${target.headSha.slice(0, 7)}) while it is open.`,
      payload: { prReview: target },
    });
    this.logger.info(
      `[BUG_HUNTER] PR review dispatched for ${repo}#${target.number} at ${target.headSha.slice(0, 7)} (run ${run.id}).`,
    );
    return true;
  }

  /**
   * A confirmed finding on a PR: say so on the PR, with the evidence, and
   * hold the finding for a person. Returns the comment URL, or null when
   * GitHub refused — the finding is held either way.
   */
  async commentForFinding(finding: BugFinding): Promise<string | null> {
    const pr = finding.metadata?.pr as BugFindingPrRef | undefined;
    if (!pr || !finding.repo) return null;
    if (pr.commentUrl) return pr.commentUrl; // already said

    const verdicts = Array.isArray(finding.metadata?.findingVerdicts)
      ? (finding.metadata!.findingVerdicts as BugFindingVerdict[])
      : [];
    const confirmed = [...verdicts]
      .reverse()
      .find((v) => v.verdict === 'confirmed');
    const body = [
      `### Bug Hunter: ${clipDossierText(finding.title, 160)}`,
      `_Found reviewing this PR at ${pr.headSha.slice(0, 7)}; confirmed by an independent Verifier${confirmed?.by.engine ? ` on ${confirmed.by.engine}` : ''}. A comment, not a check: merge is your call._`,
      ``,
      clipDossierText(finding.description, 1200),
      finding.evidence
        ? `\n**Evidence**\n\`\`\`\n${clipDossierText(finding.evidence, 800)}\n\`\`\``
        : '',
      confirmed?.reproduction
        ? `\n**Reproduced by**: ${clipDossierText(confirmed.reproduction, 600)}`
        : '',
      finding.severity ? `\nSeverity ${finding.severity}.` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    const url = await this.github.createPullRequestReview(
      finding.repo,
      pr.number,
      {
        commitId: pr.headSha,
        body,
        comments: finding.file
          ? [
              {
                path: finding.file,
                body: `See the review body: ${clipDossierText(finding.title, 120)}`,
              },
            ]
          : [],
      },
    );

    const nextPr: BugFindingPrRef = {
      ...pr,
      commentUrl: url,
      commentedAt: url ? new Date().toISOString() : null,
    };
    await this.findingRepository.update(finding.id, {
      metadata: { ...(finding.metadata ?? {}), pr: nextPr } as Record<
        string,
        any
      >,
    });
    finding.metadata = { ...(finding.metadata ?? {}), pr: nextPr };
    if (finding.status === BugFindingStatus.NEW) {
      await this.bugFindingService.setStatus(finding.id, {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
    }
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: BugHuntEventStage.ESCALATED,
      summary: url
        ? `Commented on ${pr.url} with this finding and the Verifier's reproduction; the PR's author owns the change.`
        : `Could not comment on ${pr.url}; the finding is held here for a person instead.`,
      payload: { move: 'comment_on_pr', pr: nextPr },
    });
    return url;
  }
}
