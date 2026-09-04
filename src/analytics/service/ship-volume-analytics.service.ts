import { Injectable } from '@nestjs/common';
import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  SHIP_VOLUME_CACHE_TTL_SECONDS,
  SHIP_VOLUME_DEFAULT_WEEKS,
  SHIP_VOLUME_REPOS,
  shipVolumeCacheKey,
} from '../constants/ship-volume.constants';
import {
  ShipVolumeQueryDto,
  ShipVolumeRepoDto,
  ShipVolumeResponseDto,
  ShipVolumeUnavailableRepoDto,
  ShipVolumeWeekDto,
} from '../dto/ship-volume-analytics.dto';
import { isoDate } from '../util/analytics-window.util';

/**
 * One week of one repo, straight off GitHub: `[unixWeekStart, added, deleted]`
 * with `deleted` negative. GitHub anchors these weeks on Sunday 00:00 UTC.
 */
type CodeFrequencyWeek = [number, number, number];

interface RepoSeries {
  repo: string;
  weeks: CodeFrequencyWeek[];
  /** Present when this repo's numbers could not be read fresh this time. */
  problem?: Omit<ShipVolumeUnavailableRepoDto, 'repo'>;
}

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weekly changed-line volume across the Ally repos, for Analytics → Product
 * management.
 *
 * ## Where the numbers come from
 *
 * GitHub's `/stats/code_frequency`, one call per repo, which returns the repo's
 * ENTIRE weekly history of additions and deletions on its default branch. That
 * is the whole reason this feature needs no table, no migration and no ingestion
 * job: the aggregate we want is a first-class thing GitHub already computes and
 * caches. Seven calls answer the request.
 *
 * The alternative — walking commits or merged PRs to get per-file paths, and so
 * a code/test/docs split — was rejected for now. It costs a stored table, a
 * nightly job and thousands of API calls, and it would not change the shape of
 * the chart. Worth revisiting only if the split becomes the question being
 * asked; a third of landings are direct pushes rather than PRs, so any such walk
 * must go via commits, not `/pulls`.
 *
 * ## The two honesty problems this class exists to solve
 *
 * **GitHub answers 202 while it recomputes.** Its statistics cache is
 * invalidated by a push, so an empty `{}` comes back exactly when someone has
 * just merged something and gone to look at the chart. Every repo's last good
 * series is therefore kept in Redis and served in that gap, and the response
 * says which repos were served stale.
 *
 * **A missing repo silently shortens every bar.** Churn is a sum across repos;
 * if `ally-web` drops out, the whole axis quietly loses about a third and looks
 * fine. So a repo that can be neither fetched nor recovered from cache is
 * reported in `unavailableRepos` with `servedFromCache: false`, and the client
 * is required to say so on the chart's face.
 */
@Injectable()
export class ShipVolumeAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    ShipVolumeAnalyticsService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly redisService: RedisService,
  ) {}

  async getShipVolume(
    query: ShipVolumeQueryDto = {},
  ): Promise<ShipVolumeResponseDto> {
    const weeksRequested = query.weeks ?? SHIP_VOLUME_DEFAULT_WEEKS;
    const axis = buildWeekAxis(new Date(), weeksRequested);
    const currentWeekStart = axis[axis.length - 1];

    const series = await this.loadAllRepos();

    // (weekStart -> repo -> totals). Only weeks on the axis are kept; the API
    // hands back the repo's whole life, which for the wiki is a couple of years.
    const inWindow = new Set(axis);
    const cells = new Map<
      string,
      Map<string, { added: number; deleted: number }>
    >();
    const churnByRepo = new Map<string, number>();

    for (const { repo, weeks } of series) {
      for (const [ts, added, deleted] of weeks) {
        const weekStart = isoDate(new Date(ts * 1000));
        if (!inWindow.has(weekStart)) continue;

        // GitHub reports deletions negative; we plot a positive count.
        const removed = Math.abs(deleted);
        if (added === 0 && removed === 0) continue;

        const row = cells.get(weekStart) ?? new Map();
        row.set(repo, { added, deleted: removed });
        cells.set(weekStart, row);
        churnByRepo.set(repo, (churnByRepo.get(repo) ?? 0) + added + removed);
      }
    }

    // The domain is ranked ONCE, on window-wide churn, so stack order, legend
    // order and colour do not move when the reader changes the window. Repos
    // with nothing in the window are absent rather than present as an empty
    // band. Ties break on name so the order is deterministic across requests.
    const repos = [...churnByRepo.entries()]
      .filter(([, churn]) => churn > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([repo]) => repo);

    const plotted = { added: 0, deleted: 0, churn: 0 };
    const weeks: ShipVolumeWeekDto[] = axis.map((weekStart) => {
      const row = cells.get(weekStart);
      const perRepo: ShipVolumeRepoDto[] = [];
      let added = 0;
      let deleted = 0;

      // Iterating `repos` rather than the row's own keys is what keeps every
      // week's `repos` array in the domain's order.
      for (const repo of repos) {
        const cell = row?.get(repo);
        if (!cell) continue;
        perRepo.push({
          repo,
          added: cell.added,
          deleted: cell.deleted,
          churn: cell.added + cell.deleted,
        });
        added += cell.added;
        deleted += cell.deleted;
      }

      plotted.added += added;
      plotted.deleted += deleted;
      plotted.churn += added + deleted;

      return {
        weekStart,
        added,
        deleted,
        churn: added + deleted,
        partial: weekStart === currentWeekStart,
        repos: perRepo,
      };
    });

    const unavailableRepos: ShipVolumeUnavailableRepoDto[] = series
      .filter(
        (
          s,
        ): s is RepoSeries & { problem: NonNullable<RepoSeries['problem']> } =>
          Boolean(s.problem),
      )
      .map(({ repo, problem }) => ({ repo, ...problem }));

    return {
      weeks,
      repos,
      currentWeekStart,
      weeksRequested,
      plotted,
      unavailableRepos,
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Every repo's series, fetched concurrently.
   *
   * `allSettled`, not `all`: one repo being unreadable must degrade that band,
   * not the chart. Same reasoning as `MobileReleasesService.listRuns()`.
   */
  private async loadAllRepos(): Promise<RepoSeries[]> {
    if (!this.configService.githubToken) {
      this.logger.warn(
        'GITHUB_TOKEN is not set; ship-volume has no data source in this environment',
      );
      return SHIP_VOLUME_REPOS.map((repo) => ({
        repo,
        weeks: [],
        problem: { reason: 'not_configured' as const, servedFromCache: false },
      }));
    }

    const settled = await Promise.allSettled(
      SHIP_VOLUME_REPOS.map((repo) => this.loadRepo(repo)),
    );

    return settled.map((result, index) => {
      const repo = SHIP_VOLUME_REPOS[index];
      if (result.status === 'fulfilled') return result.value;

      // loadRepo() already converts every expected failure into a problem
      // field, so landing here means something genuinely unforeseen.
      this.logger.error(
        `ship-volume: unexpected failure loading ${repo}`,
        result.reason,
      );
      return {
        repo,
        weeks: [],
        problem: { reason: 'unreachable' as const, servedFromCache: false },
      };
    });
  }

  /**
   * One repo: fetch, and fall back to the cached series when the fetch cannot
   * produce numbers.
   */
  private async loadRepo(repo: string): Promise<RepoSeries> {
    const fetched = await this.fetchCodeFrequency(repo);

    if (fetched.weeks) {
      // Fire-and-forget: a failed cache write leaves this response correct and
      // only costs the NEXT reader their stale fallback.
      void this.cacheSeries(repo, fetched.weeks);
      return { repo, weeks: fetched.weeks };
    }

    const cached = await this.readCachedSeries(repo);
    return {
      repo,
      weeks: cached ?? [],
      problem: {
        reason: fetched.reason,
        servedFromCache: Boolean(cached),
      },
    };
  }

  /**
   * `GET /repos/{org}/{repo}/stats/code_frequency`.
   *
   * A 202 with an empty body is GitHub saying "come back, I am computing this" —
   * not an error, and it is indistinguishable from a real answer by status code
   * alone on some paths, so the array shape is what we test. A genuinely empty
   * repo would return `[]`, which is an array and therefore an answer.
   */
  private async fetchCodeFrequency(
    repo: string,
  ): Promise<
    | { weeks: CodeFrequencyWeek[]; reason?: never }
    | { weeks?: never; reason: 'computing' | 'unreachable' }
  > {
    try {
      const { data, status } = await axios.get(
        `${GITHUB_API}/repos/${this.configService.githubOrg}/${repo}/stats/code_frequency`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.configService.githubToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

      if (!Array.isArray(data)) {
        this.logger.info(
          `ship-volume: ${repo} statistics still computing (HTTP ${status})`,
        );
        return { reason: 'computing' };
      }

      return { weeks: data.filter(isCodeFrequencyWeek) };
    } catch (error) {
      this.logger.error(
        `ship-volume: could not read ${repo} statistics`,
        error,
      );
      return { reason: 'unreachable' };
    }
  }

  private async cacheSeries(
    repo: string,
    weeks: CodeFrequencyWeek[],
  ): Promise<void> {
    try {
      await this.redisService.set(
        shipVolumeCacheKey(repo),
        JSON.stringify(weeks),
        SHIP_VOLUME_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`ship-volume: could not cache ${repo} series`, error);
    }
  }

  private async readCachedSeries(
    repo: string,
  ): Promise<CodeFrequencyWeek[] | null> {
    try {
      const raw = await this.redisService.get(shipVolumeCacheKey(repo));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isCodeFrequencyWeek) : null;
    } catch (error) {
      this.logger.warn(
        `ship-volume: could not read cached ${repo} series`,
        error,
      );
      return null;
    }
  }
}

const isCodeFrequencyWeek = (row: unknown): row is CodeFrequencyWeek =>
  Array.isArray(row) &&
  row.length >= 3 &&
  row.every((n) => typeof n === 'number');

/**
 * The Sundays of the last `weeks` weeks, oldest first, ending with the week
 * `now` falls in.
 *
 * Built from the calendar rather than from the data, which is what makes the
 * axis dense: a week nobody pushed in is still a week, and assembling the axis
 * out of the weeks that happen to have commits invites the reader to compare two
 * adjacent bars a month apart.
 */
export const buildWeekAxis = (now: Date, weeks: number): string[] => {
  const sunday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay(),
  );
  return Array.from({ length: weeks }, (_, i) =>
    isoDate(new Date(sunday - (weeks - 1 - i) * WEEK_MS)),
  );
};
