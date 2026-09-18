import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  ParsedChangelogEntry,
  parseChangelog,
} from '../util/changelog-parser.util';

/** The repo and file that ARE the changelog. */
const CHANGELOG_REPO = 'ally-changelog';
const CHANGELOG_PATH = 'CHANGELOG.md';

/** How old the parsed copy may get before the next read refreshes it. */
const REFRESH_AFTER_MS = 5 * 60 * 1000;

/**
 * Deliberately no TTL on the Redis key. The TTL above decides when to REFRESH;
 * the cached copy is also the fallback for when GitHub cannot be reached, and
 * an expiring key would throw that away precisely when it is needed.
 */
const CACHE_KEY = 'changelog:source:v1';

interface CachedChangelog {
  fetchedAt: number;
  entries: ParsedChangelogEntry[];
}

/** What lands in Redis — `mergedAt` survives JSON as an ISO string. */
interface SerialisedCache {
  fetchedAt: number;
  entries: (Omit<ParsedChangelogEntry, 'mergedAt'> & { mergedAt: string })[];
}

/**
 * Reads the public changelog from `ally-changelog`'s CHANGELOG.md.
 *
 * That file is the source of truth and always was — it is what a human edits
 * when a drafted line is wrong. Until now ally-be also kept a row per entry,
 * written by the repo's GitHub Action at merge time, which meant the published
 * feed could not be corrected at all: there was an append path and no other.
 * Correcting 71 badly-drafted entries in the file changed nothing on the public
 * page. So the table went and this took its place.
 *
 * ## Why the raw media type
 *
 * The Contents API's JSON representation (base64 `content`) is capped at 1 MB.
 * CHANGELOG.md passed 400 KB inside its first month and only ever grows, so
 * the JSON form has a visible expiry date on it. `application/vnd.github.raw`
 * returns the bytes directly and is good to 100 MB — decades of merges.
 */
@Injectable()
export class ChangelogSourceService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ChangelogSourceService.name,
  );

  /** Process-local copy, so a request never pays for Redis or a parse. */
  private cached: CachedChangelog | null = null;

  /** Single-flight: a refresh in progress is shared, not repeated per request. */
  private refreshing: Promise<ParsedChangelogEntry[]> | null = null;

  constructor(
    private readonly configService: AppConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * An environment with no token cannot ever serve this feed — every request
   * will 404 at GitHub and answer 503. That is worth knowing at boot rather
   * than the first time someone opens the public page, because the symptom
   * (a generic error on a marketing page) points nowhere near the cause.
   */
  onModuleInit(): void {
    if (!this.configService.changelogSourceToken) {
      this.logger.warn(
        'No GITHUB_CHANGELOG_TOKEN or GITHUB_TOKEN is configured — ' +
          `GET /v1/changelog/public will answer 503. Set GITHUB_CHANGELOG_TOKEN to a token with Contents: read on ${this.configService.githubOrg}/${CHANGELOG_REPO}.`,
      );
    }
  }

  async getEntries(): Promise<ParsedChangelogEntry[]> {
    if (this.isFresh(this.cached)) {
      return this.cached!.entries;
    }

    // Cold process: an instance that just booted (or was just deployed) picks
    // up whatever the last instance parsed instead of making its own call.
    if (!this.cached) {
      this.cached = await this.readCache();
      if (this.isFresh(this.cached)) {
        return this.cached!.entries;
      }
    }

    return this.refresh();
  }

  private isFresh(cached: CachedChangelog | null): boolean {
    return Boolean(cached && Date.now() - cached.fetchedAt < REFRESH_AFTER_MS);
  }

  private async refresh(): Promise<ParsedChangelogEntry[]> {
    if (!this.refreshing) {
      this.refreshing = this.fetchAndParse().finally(() => {
        this.refreshing = null;
      });
    }

    try {
      return await this.refreshing;
    } catch (error) {
      // A stale changelog is a far better answer than an error page, so an
      // unreachable GitHub only degrades the feed's freshness. With nothing
      // cached at all there is no honest answer but 503.
      if (this.cached) {
        this.logger.warn(
          `Serving changelog cached at ${new Date(
            this.cached.fetchedAt,
          ).toISOString()} — refresh failed: ${(error as Error).message}`,
        );
        return this.cached.entries;
      }
      // Nothing cached, so this is the branch that fails a request. Log the
      // real cause here: the exception below is all CloudWatch would otherwise
      // hold, and "temporarily unavailable" does not distinguish a missing
      // token from a 404, a timeout or a file that stopped parsing.
      this.logger.error(
        `Could not load the changelog and have nothing cached to serve — answering 503: ${
          (error as Error).message
        }`,
        error,
      );
      throw new ServiceUnavailableException(
        'The changelog is temporarily unavailable.',
      );
    }
  }

  private async fetchAndParse(): Promise<ParsedChangelogEntry[]> {
    const markdown = await this.fetchMarkdown();
    const { entries, skipped } = parseChangelog(markdown);

    if (skipped > 0) {
      this.logger.warn(
        `Skipped ${skipped} malformed changelog entr${
          skipped === 1 ? 'y' : 'ies'
        } while parsing ${CHANGELOG_PATH}.`,
      );
    }
    // An empty parse means the format moved under us — the file is never
    // legitimately empty. Refuse it so the previous good copy stays in place
    // rather than being overwritten with nothing.
    if (entries.length === 0) {
      throw new Error(
        `Parsed 0 entries from ${CHANGELOG_PATH} (${markdown.length} bytes) — format may have changed.`,
      );
    }

    this.cached = { fetchedAt: Date.now(), entries };
    await this.writeCache(this.cached);
    return entries;
  }

  private async fetchMarkdown(): Promise<string> {
    const token = this.configService.changelogSourceToken;
    if (!token) {
      throw new Error(
        `No changelog GitHub token configured — set GITHUB_CHANGELOG_TOKEN (Contents: read on ${this.configService.githubOrg}/${CHANGELOG_REPO}) or GITHUB_TOKEN.`,
      );
    }

    const url = `https://api.github.com/repos/${this.configService.githubOrg}/${CHANGELOG_REPO}/contents/${CHANGELOG_PATH}`;

    let response;
    try {
      response = await axios.get<string>(url, {
        headers: {
          Accept: 'application/vnd.github.raw',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        // The raw media type returns markdown; without this axios would try to
        // parse a document that happens to start with "#" as something else.
        responseType: 'text',
        transformResponse: [(data: string) => data],
        timeout: 20_000,
      });
    } catch (error) {
      throw new Error(this.describeFetchFailure(url, error));
    }

    if (typeof response.data !== 'string' || response.data.length === 0) {
      throw new Error(`Empty response reading ${CHANGELOG_PATH}.`);
    }
    return response.data;
  }

  /**
   * Turns an axios failure into a sentence someone reading CloudWatch at 2am
   * can act on. Bare `Request failed with status code 404` is the single most
   * misleading thing this call can say: the repo is private, so a token that
   * cannot see it is indistinguishable from a file that is not there, and the
   * fix for the former (widen the token's repo list) is nothing like the fix
   * for the latter.
   */
  private describeFetchFailure(url: string, error: unknown): string {
    // Read the status off the shape rather than through `isAxiosError`, which
    // an automocked axios replaces with a stub that answers false to
    // everything — the branch below would then be untestable.
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    const message = (error as Error)?.message ?? String(error);

    if (status === 404) {
      return `GitHub returned 404 for ${url}. The repo is private, so this is almost always a token that cannot see it rather than a missing file — check that the configured token grants Contents: read on ${this.configService.githubOrg}/${CHANGELOG_REPO}.`;
    }
    if (status === 401 || status === 403) {
      return `GitHub returned ${status} for ${url} — the configured changelog token is rejected, expired or rate-limited.`;
    }
    if (status) {
      return `GitHub returned ${status} for ${url}: ${message}`;
    }
    return `Could not reach GitHub for ${url}: ${message}`;
  }

  private async readCache(): Promise<CachedChangelog | null> {
    try {
      const raw = await this.redisService.get(CACHE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as SerialisedCache;
      return {
        fetchedAt: parsed.fetchedAt,
        entries: parsed.entries.map((entry) => ({
          ...entry,
          mergedAt: new Date(entry.mergedAt),
        })),
      };
    } catch (error) {
      // A missing or unreadable cache is a cold start, not a failure.
      this.logger.warn(
        `Could not read the cached changelog: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(cached: CachedChangelog): Promise<void> {
    try {
      await this.redisService.set(CACHE_KEY, JSON.stringify(cached));
    } catch (error) {
      this.logger.warn(
        `Could not cache the changelog: ${(error as Error).message}`,
      );
    }
  }
}
