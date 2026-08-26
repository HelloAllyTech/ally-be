import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { GithubActionsService } from 'src/bug-hunter/service/github-actions.service';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderPullRequestRepository } from '../repository/builder-build.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderNotificationService } from './builder-notification.service';
import { isBuilderRepo } from '../constants/builder-repos.constants';

/**
 * The pull requests a session opened, and keeping them current.
 *
 * Builder's job ends at "opened" — a human reviews and merges — but the
 * session view is where someone comes back to see how it went, so the PR rows
 * have to keep learning about CI and merges that happen after the agent is
 * gone.
 */
@Injectable()
export class BuilderPullRequestService {
  private readonly logger = LoggerService.getInstance(
    BuilderPullRequestService.name,
  );

  constructor(
    private readonly repository: BuilderPullRequestRepository,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly notificationService: BuilderNotificationService,
    private readonly github: GithubActionsService,
  ) {}

  /**
   * Record what the runner opened. Upserted per repo: a resume run pushes
   * more commits to the same branch, which updates the existing PR rather
   * than opening another, and a second row would make the session look like
   * it opened twice as much as it did.
   */
  async recordFromRunner(
    sessionId: string,
    runId: string,
    incoming: {
      repo?: string;
      branch?: string;
      prNumber?: number;
      prUrl?: string;
      title?: string;
    }[],
  ): Promise<BuilderPullRequest[]> {
    const results: BuilderPullRequest[] = [];

    for (const entry of incoming) {
      const repo = String(entry.repo ?? '');
      if (!isBuilderRepo(repo) || !entry.prUrl || !entry.prNumber) {
        this.logger.warn(
          `Builder run ${runId} reported an unusable pull request for "${repo}" — skipping.`,
        );
        continue;
      }

      const existing = await this.repository.findOne({
        where: { sessionId, repo },
      });
      const payload = {
        sessionId,
        runId,
        repo,
        branch: String(entry.branch ?? ''),
        prNumber: Number(entry.prNumber),
        prUrl: String(entry.prUrl),
        title: entry.title ? String(entry.title) : null,
      };

      if (existing) {
        await this.repository.update({ id: existing.id }, payload);
        results.push(
          await this.repository.findOneOrFail({ where: { id: existing.id } }),
        );
      } else {
        results.push(
          await this.repository.save(this.repository.create(payload)),
        );
      }
    }

    if (results.length) {
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });
      if (session) {
        await this.notificationService.prsOpened(session, results.length);
      }
    }
    return results;
  }

  /**
   * Refresh merge state for every open PR.
   *
   * Best-effort throughout: this is a nicety on a session that has already
   * finished its work, so a GitHub hiccup should cost a stale chip, never an
   * error anyone sees.
   */
  async reconcileOpenPullRequests(): Promise<void> {
    if (!this.github.isConfigured) return;

    const open = await this.repository.listUnmerged();
    for (const pullRequest of open) {
      try {
        const remote = await this.github.getPullRequest(
          pullRequest.repo,
          pullRequest.prNumber,
        );
        if (!remote) continue;
        if (remote.merged && !pullRequest.merged) {
          await this.repository.update(
            { id: pullRequest.id },
            { merged: true, mergedAt: remote.mergedAt ?? new Date() },
          );
        }
      } catch (error) {
        this.logger.warn(
          `Could not refresh ${pullRequest.repo}#${pullRequest.prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  listBySession(sessionId: string): Promise<BuilderPullRequest[]> {
    return this.repository.listBySession(sessionId);
  }
}
