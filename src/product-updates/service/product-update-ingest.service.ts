import { Injectable } from '@nestjs/common';

import { ChangelogSourceService } from 'src/changelog/service/changelog-source.service';
import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  ProductUpdateSource,
  ProductUpdateSourceStatus,
} from '../entity/product-update-source.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { JournalEntry, parseJournal } from '../util/journal-parser.util';
import { deployablesFor } from '../util/liveness.util';
import { gatesLiveness } from '../util/source-signals.util';

/** A PR description or a push's commit bodies, capped: enough to understand a change, not a novel. */
const BODY_CAP = 6000;

/** After this many failed GitHub reads a change goes forward on the journal's text alone. */
const MAX_ENRICH_ATTEMPTS = 3;

const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by):/i;

/**
 * Journal → `product_update_sources`, then each source's details from GitHub.
 *
 * The journal says a merge happened and names it; GitHub says what it was: a
 * PR's description and branch, a push's full commit messages, and — for both —
 * the files it changed, which decide where it shows up and what must release
 * before it is live.
 */
@Injectable()
export class ProductUpdateIngestService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateIngestService.name,
  );

  constructor(
    private readonly changelogSource: ChangelogSourceService,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly github: GithubActionsService,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Records every journal entry merged on or after the configured start that
   * has not been recorded before. Idempotent: the journal's own id is the key.
   */
  async ingestJournal(): Promise<{ added: number; skipped: number }> {
    const markdown = await this.changelogSource.fetchRawMarkdown();
    const { entries, skipped } = parseJournal(markdown);
    if (skipped > 0) {
      this.logger.warn(
        `Skipped ${skipped} journal block(s) that no longer parse.`,
      );
    }

    const start = this.configService.productUpdates.startAt;
    const candidates = entries.filter((entry) => entry.mergedAt >= start);

    let added = 0;
    for (let index = 0; index < candidates.length; index += 500) {
      const chunk = candidates.slice(index, index + 500);
      const known = await this.sourceRepository.knownJournalIds(
        chunk.map((entry) => entry.id),
      );
      const fresh = chunk
        .filter((entry) => !known.has(entry.id))
        .map((entry) => this.toSource(entry));
      if (fresh.length === 0) continue;
      // orIgnore: two replicas reading the same journal must not fail on the
      // unique journal id — the second insert is simply a no-op.
      const result = await this.sourceRepository
        .createQueryBuilder()
        .insert()
        .values(fresh)
        .orIgnore()
        .execute();
      added += result.identifiers.filter(Boolean).length;
    }
    return { added, skipped };
  }

  private toSource(entry: JournalEntry): Partial<ProductUpdateSource> {
    return {
      journalId: entry.id,
      status: ProductUpdateSourceStatus.PENDING,
      repo: entry.repo,
      apps: entry.apps,
      mergedAt: entry.mergedAt,
      journalLabel: entry.label,
      prNumber: entry.pr?.number ?? null,
      prUrl: entry.pr?.url ?? entry.compare?.url ?? null,
      // Capped to the column: sources insert in batches of 500, so one
      // oversized value would fail every entry in the pass.
      author: (entry.pr?.author ?? entry.actor)?.slice(0, 120) ?? null,
      subjects: entry.pr
        ? [entry.pr.title]
        : entry.commits.map((commit) => commit.subject),
      headSha: entry.compare?.after ?? null,
      baseSha: entry.compare?.before ?? null,
    };
  }

  /**
   * Fetches GitHub details for up to `limit` pending sources, oldest first.
   *
   * Without a GitHub token every source goes forward on the journal's text
   * alone rather than waiting forever: the model then sees less, but the
   * changelog keeps moving.
   */
  async enrichPending(
    limit: number,
  ): Promise<{ enriched: number; degraded: number }> {
    const pending = await this.sourceRepository.findByStatus(
      ProductUpdateSourceStatus.PENDING,
      { limit },
    );
    let enriched = 0;
    let degraded = 0;

    for (const source of pending) {
      const details = this.github.isConfigured
        ? await this.fetchDetails(source)
        : null;

      if (details) {
        Object.assign(source, details);
        enriched += 1;
      } else {
        source.enrichAttempts += 1;
        source.lastError = this.github.isConfigured
          ? 'GitHub details could not be read.'
          : 'GITHUB_TOKEN is not configured.';
        if (
          this.github.isConfigured &&
          source.enrichAttempts < MAX_ENRICH_ATTEMPTS
        ) {
          await this.sourceRepository.save(source);
          continue;
        }
        source.filesTruncated = true;
        degraded += 1;
      }

      source.deployables = deployablesFor(
        source.repo,
        source.files,
        source.apps,
      );
      source.gatesLiveness = gatesLiveness({
        repo: source.repo,
        author: source.author,
        mergedAt: source.mergedAt,
        headRef: source.headRef,
        prNumber: source.prNumber,
        subjects: source.subjects,
        body: source.body,
        files: source.files,
      });
      source.status = ProductUpdateSourceStatus.ENRICHED;
      source.enrichedAt = new Date();
      await this.sourceRepository.save(source);
    }

    return { enriched, degraded };
  }

  private async fetchDetails(
    source: ProductUpdateSource,
  ): Promise<Partial<ProductUpdateSource> | null> {
    if (source.prNumber !== null) {
      const summary = await this.github.getPullRequestSummary(
        source.repo,
        source.prNumber,
      );
      if (!summary) return null;
      const { files, truncated } = await this.github.listPullRequestFiles(
        source.repo,
        source.prNumber,
      );
      return {
        subjects: [summary.title || source.subjects[0] || ''],
        body: cap(summary.body),
        headRef: summary.headRef,
        headSha: summary.mergeCommitSha ?? source.headSha,
        author: summary.authorLogin ?? source.author,
        files,
        filesTruncated: truncated,
      };
    }

    if (!source.baseSha || !source.headSha) return null;
    const comparison = await this.github.compareCommits(
      source.repo,
      source.baseSha,
      source.headSha,
    );
    if (!comparison) return null;

    // Merge commits restate the PRs they merged; the commits themselves say it better.
    const commits = comparison.commits.filter(
      (commit) =>
        !/^Merge (pull request|branch|remote-tracking)/.test(commit.message),
    );
    const subjects = commits.map((commit) =>
      commit.message.split('\n')[0].trim(),
    );
    const bodies = commits
      .map((commit) => {
        const [subject, ...rest] = commit.message.split('\n');
        const body = rest
          .filter((line) => !TRAILER.test(line.trim()))
          .join('\n')
          .trim();
        return body ? `${subject.trim()}\n${body}` : null;
      })
      .filter(Boolean)
      .join('\n\n');

    return {
      subjects: subjects.length ? subjects : source.subjects,
      body: cap(bodies || null),
      files: comparison.files,
      filesTruncated: comparison.truncated,
      author:
        commits.find((commit) => commit.authorLogin)?.authorLogin ??
        source.author,
    };
  }
}

function cap(text: string | null): string | null {
  if (!text) return null;
  return text.length > BODY_CAP ? `${text.slice(0, BODY_CAP)}…` : text;
}
