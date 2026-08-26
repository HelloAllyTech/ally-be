import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import {
  BUILDER_GITHUB_FILE_MAX_BYTES,
  BUILDER_GITHUB_SEARCH_MAX_RESULTS,
  BUILDER_GITHUB_TREE_MAX_ENTRIES,
} from '../constants/builder.constants';
import { isBuilderRepo } from '../constants/builder-repos.constants';

/**
 * Read-only GitHub REST access for the interview agent: search code, read a
 * file, list a tree.
 *
 * Deliberately separate from Bug Hunter's GithubActionsService, which is a
 * *write* client (dispatch, cancel). Same plain-axios approach and the same
 * GITHUB_TOKEN, no Octokit — see that file for why. Extracting a shared
 * `src/github/` module once both exist is a worthwhile cleanup, but it is not
 * a prerequisite for this feature.
 *
 * Every method returns a plain object rather than throwing on a bad request:
 * these are LLM tool implementations, and a structured `{ ok: false }` is
 * something the model can recover from, where an exception ends the turn.
 */
@Injectable()
export class BuilderGithubReadService {
  private readonly logger = LoggerService.getInstance(
    BuilderGithubReadService.name,
  );

  constructor(private readonly configService: AppConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.configService.githubToken);
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.configService.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private get org(): string {
    return this.configService.githubOrg;
  }

  /**
   * Code search across the org (or one repo). Returns paths and repo names
   * only — GitHub's fragments are noisy and the agent should follow up with
   * readFile on the two or three that look right.
   */
  async searchCode(query: string, repo?: string): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (repo && !isBuilderRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    const scope = repo ? `repo:${this.org}/${repo}` : `org:${this.org}`;
    try {
      const response = await axios.get('https://api.github.com/search/code', {
        headers: this.headers,
        params: {
          q: `${query} ${scope}`,
          per_page: BUILDER_GITHUB_SEARCH_MAX_RESULTS,
        },
        timeout: 20_000,
      });
      const items: any[] = response.data?.items ?? [];
      return {
        ok: true,
        totalCount: response.data?.total_count ?? items.length,
        results: items.map((item) => ({
          repo: item?.repository?.name,
          path: item?.path,
        })),
      };
    } catch (error) {
      return this.failure('search_failed', error);
    }
  }

  /**
   * One file's contents at a ref. Truncated at a hard byte cap — a 6000-line
   * service read in full would crowd out the reasoning the interview needs,
   * and the agent can always ask for a narrower path.
   */
  async readFile(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (!isBuilderRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${this.org}/${repo}/contents/${path}`,
        {
          headers: this.headers,
          params: ref ? { ref } : undefined,
          timeout: 20_000,
        },
      );
      const data = response.data;
      if (Array.isArray(data)) {
        return {
          ok: false,
          error: 'path_is_directory',
          message: `"${path}" is a directory — use github_repo_tree instead.`,
        };
      }
      if (data?.encoding !== 'base64' || typeof data?.content !== 'string') {
        return { ok: false, error: 'unreadable_file', path };
      }
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      const truncated = decoded.length > BUILDER_GITHUB_FILE_MAX_BYTES;
      return {
        ok: true,
        repo,
        path,
        size: data.size,
        truncated,
        content: truncated
          ? decoded.slice(0, BUILDER_GITHUB_FILE_MAX_BYTES)
          : decoded,
        ...(truncated
          ? {
              note: `Truncated at ${BUILDER_GITHUB_FILE_MAX_BYTES} bytes. Read a narrower path if you need the rest.`,
            }
          : {}),
      };
    } catch (error) {
      return this.failure('read_failed', error);
    }
  }

  /**
   * Repo file tree, optionally filtered to a subpath. Capped in entry count
   * for the same reason readFile is capped in bytes.
   */
  async repoTree(
    repo: string,
    path?: string,
    ref = 'master',
  ): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (!isBuilderRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${this.org}/${repo}/git/trees/${ref}`,
        {
          headers: this.headers,
          params: { recursive: '1' },
          timeout: 30_000,
        },
      );
      const prefix = path?.replace(/^\/+|\/+$/g, '');
      const all: any[] = response.data?.tree ?? [];
      const filtered = all
        .filter((entry) => entry?.type === 'blob')
        .map((entry) => entry.path as string)
        .filter((entryPath) => !prefix || entryPath.startsWith(`${prefix}/`));
      const truncated = filtered.length > BUILDER_GITHUB_TREE_MAX_ENTRIES;
      return {
        ok: true,
        repo,
        ref,
        ...(prefix ? { path: prefix } : {}),
        totalCount: filtered.length,
        truncated,
        // GitHub's own truncation flag matters too: a huge repo's tree comes
        // back partial, and a confident "this file does not exist" drawn from
        // a partial tree is worse than no answer.
        githubTruncated: Boolean(response.data?.truncated),
        files: filtered.slice(0, BUILDER_GITHUB_TREE_MAX_ENTRIES),
      };
    } catch (error) {
      return this.failure('tree_failed', error);
    }
  }

  private notConfigured(): Record<string, any> {
    return {
      ok: false,
      error: 'github_not_configured',
      message:
        'GITHUB_TOKEN is not set on this environment, so codebase lookups are unavailable. ' +
        'Say so plainly and continue the interview from the repo maps and the admin’s answers.',
    };
  }

  private failure(code: string, error: unknown): Record<string, any> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Builder GitHub ${code}: ${message}`);
    return { ok: false, error: code, message };
  }
}
