import { BadRequestException, Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_REPOS,
  BUG_HUNT_SWEEP_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { FEATURE_MAP_CARDS_PER_RUN } from '../constants/bug-feature-map-prompt';
import { BugHunterFeatureMap } from '../entity/bug-hunter-feature-map.entity';
import { BugHunterMode } from '../enum/bug-finding.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHunterFeatureMapRepository } from '../repository/bug-hunter-feature-map.repository';
import { precedentKeywords } from './bug-hunter-precedent.service';
import { BugHunterService } from './bug-hunter.service';

export const BUG_HUNT_FEATURE_MAP_TASK = 'bug-hunter-feature-map';

/** A card as a map run posts it, before validation. */
export interface FeatureCardInput {
  slug?: unknown;
  title?: unknown;
  summary?: unknown;
  entryPoints?: unknown;
  endpoints?: unknown;
  dataHomes?: unknown;
  writtenBy?: unknown;
  relatedRepos?: unknown;
  gotchas?: unknown;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const list = (v: unknown, maxItems = 20, maxChars = 300): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => text(x, maxChars))
        .filter((x): x is string => x != null)
        .slice(0, maxItems)
    : [];

/**
 * The feature map: one card per user-facing feature, written weekly by a
 * read-only run per repo and served to every study, verifier and fix session
 * whose bug reads like the feature (see BugHunterFeatureMap for why).
 */
@Injectable()
export class BugHunterFeatureMapService {
  private readonly logger = LoggerService.getInstance(
    BugHunterFeatureMapService.name,
  );

  constructor(
    private readonly repository: BugHunterFeatureMapRepository,
    private readonly bugHunterService: BugHunterService,
    private readonly github: GithubActionsService,
    private readonly configService: AppConfigService,
  ) {}

  /** Validate and upsert one batch of cards from a map run. Returns how many were saved. */
  async save(params: {
    repo: string;
    runId: string | null;
    sourceSha: string | null;
    cards: FeatureCardInput[];
  }): Promise<{ saved: number; slugs: string[] }> {
    if (!BUG_FIX_SESSION_REPOS.includes(params.repo as never)) {
      throw new BadRequestException(
        `"${params.repo}" is not an Ally repo Bug Hunter maps.`,
      );
    }
    if (!Array.isArray(params.cards) || !params.cards.length) {
      throw new BadRequestException('cards must be a non-empty list.');
    }
    if (params.cards.length > FEATURE_MAP_CARDS_PER_RUN) {
      throw new BadRequestException(
        `At most ${FEATURE_MAP_CARDS_PER_RUN} cards per batch.`,
      );
    }
    const rows = params.cards.map((c, i) => {
      const slug = text(c.slug, 80);
      const title = text(c.title, 200);
      const summary = text(c.summary, 2000);
      if (!slug || !SLUG.test(slug)) {
        throw new BadRequestException(
          `cards[${i}].slug must be kebab-case, e.g. simulation-translations.`,
        );
      }
      if (!title)
        throw new BadRequestException(`cards[${i}].title is required.`);
      if (!summary || summary.length < 80) {
        throw new BadRequestException(
          `cards[${i}].summary must say how the feature works, from where the value is stored to where it is shown (at least 80 characters).`,
        );
      }
      return {
        repo: params.repo,
        slug,
        title,
        summary,
        entryPoints: list(c.entryPoints),
        endpoints: list(c.endpoints),
        dataHomes: list(c.dataHomes),
        writtenBy: text(c.writtenBy, 600),
        relatedRepos: list(c.relatedRepos, 10),
        gotchas: list(c.gotchas, 10),
        sourceSha: text(params.sourceSha, 64),
        runId: params.runId,
      };
    });
    await this.repository.upsert(
      rows as Partial<BugHunterFeatureMap>[] as never,
      {
        conflictPaths: ['repo', 'slug'],
        skipUpdateIfNoValuesChanged: false,
      },
    );
    return { saved: rows.length, slugs: rows.map((r) => r.slug) };
  }

  list(repo?: string): Promise<BugHunterFeatureMap[]> {
    return this.repository.find({
      where: repo ? { repo } : {},
      order: { repo: 'ASC', title: 'ASC' },
    });
  }

  /**
   * The cards that fit a bug, across every repo: full-text rank over title,
   * summary and entry points, with a file the bug names counting as a match
   * whatever the words say.
   */
  async forBug(
    bug: { title: string; description: string; file?: string | null },
    limit = 3,
  ) {
    const words = precedentKeywords(
      `${bug.title} ${bug.title} ${bug.description}`,
    );
    const file = bug.file?.trim() || null;
    if (words.length < 2 && !file) return [];
    const doc = `to_tsvector('english', coalesce(m.title, '') || ' ' || coalesce(m.summary, '') || ' ' || coalesce(m.entry_points::text, '') || ' ' || coalesce(m.data_homes::text, ''))`;
    const qb = this.repository.createQueryBuilder('m');
    if (words.length >= 2) {
      qb.where(`${doc} @@ to_tsquery('english', :q)`, { q: words.join(' | ') });
      qb.orderBy(`ts_rank(${doc}, to_tsquery('english', :q))`, 'DESC');
    }
    if (file) {
      qb.orWhere(`m.entry_points::text ILIKE :file`, { file: `%${file}%` });
    }
    return qb.limit(limit).getMany();
  }

  /** Open a map run for a repo and dispatch it; null when Bug Hunter is off or the dispatch failed. */
  async dispatch(repo: string): Promise<string | null> {
    if (!BUG_FIX_SESSION_REPOS.includes(repo as never)) {
      throw new BadRequestException(
        `"${repo}" is not an Ally repo Bug Hunter maps.`,
      );
    }
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode === BugHunterMode.OFF) return null;
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.FEATURE_MAP,
      repo,
    );
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
          mode: 'map',
        },
      });
      return run.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.bugHunterService.closeRun(
        run.id,
        BugHuntRunStatus.FAILED,
        {
          foundCount: 0,
          autoMergedCount: 0,
          prOpenedCount: 0,
          dismissedCount: 0,
        },
        `Could not dispatch the feature-map run: ${message}`,
      );
      this.logger.warn(
        `[BUG_HUNTER] feature map for ${repo} not dispatched: ${message}`,
      );
      return null;
    }
  }

  /** The weekly pass: one map run per repo. Never throws. */
  async refreshAll(): Promise<void> {
    for (const repo of BUG_FIX_SESSION_REPOS) {
      try {
        await this.dispatch(repo);
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] feature map for ${repo} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
