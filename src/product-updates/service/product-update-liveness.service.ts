import { Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';

import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';
import { RELEASE_TARGETS } from 'src/release/constants/release-targets.constants';

import {
  ProductUpdateSource,
  ProductUpdateSourceStatus,
} from '../entity/product-update-source.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../repository/product-update.repository';
import {
  Deployable,
  RELEASE_HISTORY_KEYS,
  ReleaseHistory,
  ReleaseHistoryKey,
  changeLiveAt,
  trackedDeployables,
} from '../util/liveness.util';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Release history is read back this far at most, however old the oldest unreleased change is. */
const HISTORY_LIMIT_MS = 90 * DAY_MS;

/**
 * Which workflow's successful runs mean "shipped" for each deployable. The
 * five server and web ones come from `RELEASE_TARGETS`, the table Bug Hunter
 * and Builder release through, so a renamed workflow is fixed in one place.
 * ally-mobile has no entry there — it releases through store builds — so its
 * two workflows are named here.
 */
const HISTORY_WORKFLOWS: Record<
  ReleaseHistoryKey,
  { repo: string; workflow: string }
> = {
  'ally-be': RELEASE_TARGETS['ally-be'],
  'ally-ai': RELEASE_TARGETS['ally-ai'],
  'ally-ai-learn': RELEASE_TARGETS['ally-ai-learn'],
  'ally-web:admin': RELEASE_TARGETS['ally-web:admin'],
  'ally-web:helpline': RELEASE_TARGETS['ally-web:helpline'],
  'ally-mobile:build': {
    repo: 'ally-mobile',
    workflow: 'build-android-production.yml',
  },
  'ally-mobile:promote': {
    repo: 'ally-mobile',
    workflow: 'promote-android-production.yml',
  },
};

export interface LivenessResult {
  sourcesLive: number;
  updatesLive: number;
  published: number;
  /** Workflows whose history could not be read — their changes stay "waiting", never guessed live. */
  unreadable: ReleaseHistoryKey[];
}

/**
 * Decides when merged changes reached users, from release history alone.
 *
 * Reads each deployable's successful release runs once per pass (not once per
 * change), marks each consolidated change live at the first release that
 * started after it merged, and an update live once every change that gates it
 * is. A public update that becomes live is published in the same step —
 * publishing is fully automatic.
 */
@Injectable()
export class ProductUpdateLivenessService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateLivenessService.name,
  );

  constructor(
    private readonly github: GithubActionsService,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly updateRepository: ProductUpdateRepository,
  ) {}

  async refresh(now: Date = new Date()): Promise<LivenessResult> {
    const result: LivenessResult = {
      sourcesLive: 0,
      updatesLive: 0,
      published: 0,
      unreadable: [],
    };

    // Only the columns liveness reads, and writes by id below: a backfill has
    // every merge waiting at once, and loading their bodies and file lists to
    // `save()` them back ran a 512 MB task out of heap.
    const waiting = await this.sourceRepository.find({
      select: {
        id: true,
        mergedAt: true,
        deployables: true,
        gatesLiveness: true,
      },
      where: {
        status: ProductUpdateSourceStatus.CONSOLIDATED,
        liveAt: IsNull(),
      },
    });

    if (waiting.length) {
      const oldest = Math.min(
        ...waiting.map((source) => source.mergedAt.getTime()),
      );
      const since = new Date(
        Math.max(oldest, now.getTime() - HISTORY_LIMIT_MS),
      );
      const needed = new Set<ReleaseHistoryKey>();
      for (const source of waiting) {
        for (const deployable of source.deployables) {
          if (deployable === 'ally-mobile') {
            needed.add('ally-mobile:build');
            needed.add('ally-mobile:promote');
          } else if (
            (RELEASE_HISTORY_KEYS as readonly string[]).includes(deployable)
          ) {
            needed.add(deployable as ReleaseHistoryKey);
          }
        }
      }
      const { history, unreadable } = await this.loadHistory(
        [...needed],
        since,
      );
      result.unreadable = unreadable;

      const nowLive: ProductUpdateSource[] = [];
      for (const source of waiting) {
        const liveAt = source.gatesLiveness
          ? changeLiveAt(
              source.deployables as Deployable[],
              source.mergedAt,
              history,
            )
          : source.mergedAt;
        if (liveAt) {
          source.liveAt = liveAt;
          nowLive.push(source);
        }
      }
      for (const source of nowLive) {
        await this.sourceRepository.update(source.id, {
          liveAt: source.liveAt,
        });
      }
      result.sourcesLive = nowLive.length;
    }

    // Any update not yet live whose gating changes all are.
    const candidates = await this.updateRepository.findNotLive();
    for (const update of candidates) {
      const sources = (update.sources ?? []).filter(
        (source) => source.status === ProductUpdateSourceStatus.CONSOLIDATED,
      );
      if (sources.length === 0) continue;
      const gating = sources.filter((source) => source.gatesLiveness);
      const pending = gating.some((source) => !source.liveAt);
      if (pending) continue;

      const times = (gating.length ? gating : sources).map((source) =>
        (source.liveAt ?? source.mergedAt).getTime(),
      );
      update.liveAt = new Date(Math.max(...times));
      if (
        update.audience === 'public' &&
        !update.hidden &&
        !update.publishedAt
      ) {
        // The live date, not the moment this pass noticed: a backfilled update
        // was public the day it shipped, and so is one this pass saw late.
        update.publishedAt = update.liveAt;
        result.published += 1;
      }
      await this.updateRepository.update(update.id, {
        liveAt: update.liveAt,
        publishedAt: update.publishedAt,
      });
      result.updatesLive += 1;
    }

    return result;
  }

  /**
   * Which deployables a set of waiting changes still waits on — for the
   * digest's "merged, waiting on the admin release" line.
   */
  async pendingDeployablesFor(
    updateIds: string[],
  ): Promise<Map<string, string[]>> {
    const pending = new Map<string, string[]>();
    if (updateIds.length === 0) return pending;
    const sources = await this.sourceRepository.find({
      where: {
        updateId: In(updateIds),
        status: ProductUpdateSourceStatus.CONSOLIDATED,
        liveAt: IsNull(),
        gatesLiveness: true,
      },
    });
    for (const source of sources) {
      const list = pending.get(source.updateId!) ?? [];
      for (const deployable of trackedDeployables(source.deployables)) {
        if (!list.includes(deployable)) list.push(deployable);
      }
      pending.set(source.updateId!, list);
    }
    return pending;
  }

  private async loadHistory(
    keys: ReleaseHistoryKey[],
    since: Date,
  ): Promise<{ history: ReleaseHistory; unreadable: ReleaseHistoryKey[] }> {
    const history: ReleaseHistory = {};
    const unreadable: ReleaseHistoryKey[] = [];
    if (!this.github.isConfigured) {
      return { history, unreadable: keys };
    }
    await Promise.all(
      keys.map(async (key) => {
        const { repo, workflow } = HISTORY_WORKFLOWS[key];
        const runs = await this.github.listSuccessfulRuns({
          repo,
          workflow,
          since,
        });
        if (runs === null) {
          unreadable.push(key);
          return;
        }
        history[key] = runs.map((run) => ({
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        }));
      }),
    );
    if (unreadable.length) {
      this.logger.warn(
        `[PRODUCT-UPDATES] Release history unreadable for ${unreadable.join(', ')}; their changes stay waiting.`,
      );
    }
    return { history, unreadable };
  }
}
