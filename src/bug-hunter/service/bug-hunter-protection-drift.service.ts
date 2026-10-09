import { Injectable } from '@nestjs/common';

import {
  BranchProtectionSummary,
  GithubActionsService,
} from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugHuntEventRepository } from '../repository/bug-hunt-event.repository';
import { BugHunterNotificationService } from './bug-hunter-notification.service';

export const BUG_HUNT_PROTECTION_DRIFT_TASK = 'bug-hunter-protection-drift';
const SNAPSHOT_KIND = 'protection_snapshot';

export interface ProtectionDrift {
  repo: string;
  canBotMerge: boolean;
  protection: BranchProtectionSummary;
  /** Plain sentences, one per thing that disagrees. Empty when the map and GitHub agree. */
  problems: string[];
}

/**
 * The nightly check that master protection still matches what Bug Hunter's
 * repo map believes (OPP-0759).
 *
 * `canBotMerge: false` on ally-be, ally-web and ally-ai was written because
 * master required a review the bot could not give. ally-web's protection
 * was relaxed in September and ally-be's by October without the map, the
 * policy or anyone being told; the policy still refused self-merges, but a
 * person or a fix PR could land unreviewed. This reads each repo's
 * protection (classic and rulesets), compares it with the map, writes a
 * snapshot to the timeline, and raises one Problem notice per repo when the
 * state CHANGES — not every night it stays wrong, which would be noise.
 */
@Injectable()
export class BugHunterProtectionDriftService {
  private readonly logger = LoggerService.getInstance(
    BugHunterProtectionDriftService.name,
  );

  constructor(
    private readonly github: GithubActionsService,
    private readonly notifications: BugHunterNotificationService,
    private readonly eventRepository: BugHuntEventRepository,
  ) {}

  async run(): Promise<ProtectionDrift[]> {
    const drifts: ProtectionDrift[] = [];
    for (const [repo, config] of Object.entries(BUG_HUNT_REPOS)) {
      const protection = await this.github
        .getBranchProtection(repo, 'master')
        .catch(() => null);
      if (!protection) continue; // GitHub unreadable: not drift, not news
      drifts.push({
        repo,
        canBotMerge: config.canBotMerge,
        protection,
        problems: problemsFor(repo, config.canBotMerge, protection),
      });
    }
    if (!drifts.length) return drifts;

    const previous = await this.lastSnapshot();
    for (const d of drifts) {
      const before = previous?.[d.repo];
      const changed =
        JSON.stringify(before ?? null) !== JSON.stringify(summarise(d));
      if (!changed || !d.problems.length) continue;
      await this.notifications.notify({
        level: BugHunterNotificationLevel.PROBLEM,
        title: `master protection on ${d.repo} does not match what I was told`,
        body:
          `${d.problems.join(' ')}\n` +
          `GitHub today: ${describe(d.protection)}. ` +
          `Restore the protection, or change canBotMerge for ${d.repo} in bug-hunt-repos.constants.ts so the map tells the truth.`,
        repo: d.repo,
      });
    }

    const snapshot = Object.fromEntries(
      drifts.map((d) => [d.repo, summarise(d)]),
    );
    await this.eventRepository.save(
      this.eventRepository.create({
        runId: null,
        repo: null,
        stage: BugHuntEventStage.SETTINGS_CHANGED,
        summary: `Nightly protection check: ${drifts.filter((d) => d.problems.length).length} of ${drifts.length} repos drifted from the map.`,
        payload: { kind: SNAPSHOT_KIND, snapshot },
      }),
    );
    return drifts;
  }

  /** The previous run's per-repo summary, so a notice fires on change and not every night. */
  private async lastSnapshot(): Promise<Record<
    string,
    ReturnType<typeof summarise>
  > | null> {
    try {
      const rows = await this.eventRepository.find({
        where: { stage: BugHuntEventStage.SETTINGS_CHANGED },
        order: { createdAt: 'DESC' },
        take: 40,
      });
      const hit = rows.find(
        (r) =>
          (r.payload as Record<string, unknown> | null)?.kind === SNAPSHOT_KIND,
      );
      return (
        ((hit?.payload as Record<string, unknown> | null)?.snapshot as Record<
          string,
          ReturnType<typeof summarise>
        >) ?? null
      );
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not read the last protection snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/** What the map expects of GitHub, and where GitHub disagrees. Exported for the spec. */
export function problemsFor(
  repo: string,
  canBotMerge: boolean,
  p: BranchProtectionSummary,
): string[] {
  const out: string[] = [];
  if (!canBotMerge && p.reviewsRequired === 0) {
    out.push(
      `Bug Hunter's map says the bot may not merge to ${repo} because master required a review, but no review is required any more: a PR can land unreviewed. Policy still refuses Bug Hunter's own self-merges there.`,
    );
  }
  if (canBotMerge && p.reviewsRequired > 0) {
    out.push(
      `Bug Hunter's map says the bot may merge its verified fixes to ${repo}, but master now requires ${p.reviewsRequired} approving review${p.reviewsRequired === 1 ? '' : 's'}: every self-merge will be refused by GitHub.`,
    );
  }
  if (!p.requiredChecks.length) {
    out.push(
      `No status check is required on ${repo} master, so a red PR can be merged.`,
    );
  }
  return out;
}

function summarise(d: ProtectionDrift) {
  return {
    canBotMerge: d.canBotMerge,
    reviewsRequired: d.protection.reviewsRequired,
    requiredChecks: [...d.protection.requiredChecks].sort(),
    source: d.protection.source,
    problems: d.problems.length,
  };
}

function describe(p: BranchProtectionSummary): string {
  return `${p.reviewsRequired} review${p.reviewsRequired === 1 ? '' : 's'} required, checks ${
    p.requiredChecks.length ? p.requiredChecks.join(', ') : 'none'
  } (${p.source})`;
}
