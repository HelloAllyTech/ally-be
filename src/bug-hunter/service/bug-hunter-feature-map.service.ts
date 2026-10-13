import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_REPOS,
  BUG_HUNT_SWEEP_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { FEATURE_MAP_CARDS_PER_RUN } from '../constants/bug-feature-map-prompt';
import {
  BugHunterFeatureMap,
  FEATURE_VALUE_SOURCES,
  FeatureValueSource,
} from '../entity/bug-hunter-feature-map.entity';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
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
  valueSource?: unknown;
  entryPoints?: unknown;
  endpoints?: unknown;
  dataHomes?: unknown;
  writtenBy?: unknown;
  relatedRepos?: unknown;
  gotchas?: unknown;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLIENT_REPOS = ['ally-web', 'ally-mobile'];
const BACKEND_REPOS = ['ally-be', 'ally-ai', 'ally-ai-learn'];

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
    private readonly memoryService: AgentMemoryService,
  ) {}

  /**
   * Validate and save one batch of cards from a map run.
   *
   * One card per feature across repos. A card whose slug another repo
   * already owns is not duplicated: this run's part — its entry points,
   * endpoints, data homes, gotchas and its own line in relatedRepos — is
   * merged into the existing card, and the owner's summary stands. A card
   * whose value lives in a database must say which endpoint carries it and,
   * from a client repo, which backend repo stores it: a client card that
   * cannot name its source is how a label bundle got mistaken for content.
   */
  async save(params: {
    repo: string;
    runId: string | null;
    sourceSha: string | null;
    cards: FeatureCardInput[];
  }): Promise<{ saved: number; merged: number; slugs: string[] }> {
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
    const rows = params.cards.map((c, i) => this.validate(c, i, params.repo));
    let saved = 0;
    let merged = 0;
    for (const row of rows) {
      const existing = await this.repository.findOne({
        where: { slug: row.slug },
      });
      if (existing && existing.repo !== params.repo) {
        // Another repo owns this feature: add this repo's part, keep its story.
        const union = (a: string[] = [], b: string[] = [], max = 20) =>
          [...new Set([...a, ...b])].slice(0, max);
        await this.repository.update(existing.id, {
          entryPoints: union(existing.entryPoints, row.entryPoints),
          endpoints: union(existing.endpoints, row.endpoints),
          dataHomes: union(existing.dataHomes, row.dataHomes),
          relatedRepos: union(existing.relatedRepos, row.relatedRepos, 10),
          gotchas: union(existing.gotchas, row.gotchas, 10),
        });
        merged += 1;
        continue;
      }
      await this.repository.upsert(
        {
          ...row,
          repo: params.repo,
          sourceSha: text(params.sourceSha, 64),
          runId: params.runId,
        } as never,
        { conflictPaths: ['slug'], skipUpdateIfNoValuesChanged: false },
      );
      saved += 1;
    }
    return { saved, merged, slugs: rows.map((r) => r.slug) };
  }

  private validate(c: FeatureCardInput, i: number, repo: string) {
    const slug = text(c.slug, 80);
    const title = text(c.title, 200);
    const summary = text(c.summary, 2000);
    const valueSource = text(c.valueSource, 20) as FeatureValueSource | null;
    if (!slug || !SLUG.test(slug)) {
      throw new BadRequestException(
        `cards[${i}].slug must be kebab-case, e.g. simulation-titles-translated.`,
      );
    }
    if (!title) throw new BadRequestException(`cards[${i}].title is required.`);
    if (!summary || summary.length < 80) {
      throw new BadRequestException(
        `cards[${i}].summary must say how the feature works, from where the value is stored to where it is shown (at least 80 characters).`,
      );
    }
    if (!valueSource || !FEATURE_VALUE_SOURCES.includes(valueSource)) {
      throw new BadRequestException(
        `cards[${i}].valueSource must be one of ${FEATURE_VALUE_SOURCES.join(', ')}: where the value the user sees actually comes from. Labels and content are different cards.`,
      );
    }
    const dataHomes = list(c.dataHomes);
    if (!dataHomes.length) {
      throw new BadRequestException(
        `cards[${i}].dataHomes must name where the value lives: a table.column, a locale file, a config key.`,
      );
    }
    const endpoints = list(c.endpoints);
    const relatedRepos = list(c.relatedRepos, 10);
    if (valueSource === 'database') {
      if (!endpoints.length) {
        throw new BadRequestException(
          `cards[${i}] says its value comes from a database: name the endpoint that carries it in "endpoints".`,
        );
      }
      if (
        CLIENT_REPOS.includes(repo) &&
        !relatedRepos.some((r) => BACKEND_REPOS.some((b) => r.startsWith(b)))
      ) {
        throw new BadRequestException(
          `cards[${i}] is a ${repo} card for a value stored in a database: name the backend repo that stores and serves it in "relatedRepos" ("ally-be: …"). Read it in /tmp/siblings.`,
        );
      }
    }
    return {
      slug,
      title,
      summary,
      valueSource,
      entryPoints: list(c.entryPoints),
      endpoints,
      dataHomes,
      writtenBy: text(c.writtenBy, 600),
      relatedRepos,
      gotchas: list(c.gotchas, 10),
    };
  }

  /**
   * A person removes a card as wrong. The reason becomes an active notebook
   * lesson for the card's repo, tagged so the next map run is shown it and
   * does not write the same card again.
   */
  async remove(
    id: string,
    userId: number,
    reason?: string | null,
  ): Promise<void> {
    const card = await this.repository.findOne({ where: { id } });
    if (!card) throw new NotFoundException(`No feature card ${id}.`);
    await this.repository.delete(id);
    const why = text(reason, 400);
    if (!why) return;
    try {
      await this.memoryService.write({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: `Feature card "${card.title}" (${card.repo}, ${card.slug}) was removed as wrong: ${why}`.slice(
          0,
          600,
        ),
        repos: [card.repo],
        tags: ['feature-map', 'wrong-card'],
        createdBy: userId,
        curated: true,
      });
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] card ${id} removed, but its lesson was not written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
