import { Injectable } from '@nestjs/common';

import {
  AGENT_MEMORY_RELEASED_GRACE_DAYS,
  AGENT_MEMORY_REPO_TRAP_TAGS,
  AGENT_MEMORY_UNUSED_AFTER_RUNS,
} from 'src/agent-memory/constants/agent-memory.constants';
import { AgentMemory } from 'src/agent-memory/entity/agent-memory.entity';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import { LoggerService } from 'src/logger/logger.service';

import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';

/** What the pass needs to know about one entry beyond the row itself. */
export interface RetirementContext {
  /**
   * How many of the entry's repos' runs have REPORTED notebook feedback since
   * the entry was written. Runs that never reported are not counted, so a
   * zero "times applied" only means something once this is large enough.
   */
  feedbackRunsSince: number;
  /** The bug the entry was written about, when it names one. */
  finding: {
    status: BugFindingStatus;
    releasedAt: Date | null;
    regressed: boolean;
  } | null;
  now: Date;
}

/**
 * The rule that fired, as the Notebook tab shows it. Pure, so the three rules
 * are tested as arithmetic rather than through a database. Returns null when
 * the entry stays.
 *
 * Pinned entries never reach this: a pin is a person outranking the agent, and
 * the worklist excludes them before any rule runs.
 */
export const decideRetirement = (
  entry: Pick<
    AgentMemory,
    | 'sourceCount'
    | 'timesApplied'
    | 'timesContradicted'
    | 'tags'
    | 'findingId'
    | 'pinned'
  >,
  ctx: RetirementContext,
): string | null => {
  if (entry.pinned) return null;

  // 1. Contradicted more often than it has been confirmed or applied. One
  //    bad night cannot do it (a fresh entry has sourceCount 1, so two
  //    contradictions are the floor); a pattern can.
  if (entry.timesContradicted > entry.timesApplied + entry.sourceCount) {
    return `Runs reported it wrong ${entry.timesContradicted} times against ${entry.timesApplied} applied and ${entry.sourceCount} independent sighting${entry.sourceCount === 1 ? '' : 's'}.`;
  }

  // 2. Never applied, across enough runs that actually said what they used.
  if (
    entry.timesApplied === 0 &&
    ctx.feedbackRunsSince >= AGENT_MEMORY_UNUSED_AFTER_RUNS
  ) {
    return `No run applied it in the last ${ctx.feedbackRunsSince} runs that reported what they used.`;
  }

  // 3. Written about one bug, and that bug shipped and stayed fixed. Repo
  //    traps (a flaky suite, a fix gotcha) outlive the bug they were found on,
  //    so an entry tagged as one is never retired for this reason.
  if (entry.findingId && ctx.finding) {
    const tags = entry.tags ?? [];
    const isRepoTrap = tags.some((t) =>
      AGENT_MEMORY_REPO_TRAP_TAGS.includes(t),
    );
    const releasedAt = ctx.finding.releasedAt;
    const graceMs = AGENT_MEMORY_RELEASED_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (
      !isRepoTrap &&
      entry.timesApplied === 0 &&
      entry.sourceCount === 1 &&
      ctx.finding.status === BugFindingStatus.RELEASED &&
      !ctx.finding.regressed &&
      releasedAt !== null &&
      ctx.now.getTime() - releasedAt.getTime() >= graceMs
    ) {
      return `The bug it was written about has been live for ${Math.floor((ctx.now.getTime() - releasedAt.getTime()) / 86_400_000)} days without coming back, and no run has needed the note since.`;
    }
  }

  return null;
};

/**
 * Bug Hunter prunes its own notebook (OPP-0752).
 *
 * The notebook is capped at 80 active entries and nothing used to leave it on
 * its own: the hourly curator removes an entry only when a new candidate
 * contradicts or subsumes it. So a lesson about a suite fixed months ago, or
 * one no sweep had applied since it was written, stayed in the twelve the
 * prompt reads every night until an admin noticed.
 *
 * This nightly pass retires — never deletes — by evidence, with the rule that
 * fired recorded on the row so the Notebook tab can show "retired by me
 * because…" and an admin can undo it. It reads the counters the runs feed
 * through `POST pipeline/memory/feedback`; until runs report, the "never
 * applied" rule cannot fire, because it counts only runs that reported.
 */
@Injectable()
export class BugHunterMemoryRetirementService {
  private readonly logger = LoggerService.getInstance(
    BugHunterMemoryRetirementService.name,
  );

  constructor(
    private readonly memoryService: AgentMemoryService,
    private readonly findingRepository: BugFindingRepository,
    private readonly runRepository: BugHuntRunRepository,
  ) {}

  /** One pass over Bug Hunter's active, unpinned entries. Returns how many it retired. */
  async run(now: Date = new Date()): Promise<number> {
    const entries = await this.memoryService.listActiveUnpinned(
      AgentMemoryAgent.BUG_HUNTER,
    );
    let retired = 0;
    for (const entry of entries) {
      try {
        const ctx = await this.contextFor(entry, now);
        const reason = decideRetirement(entry, ctx);
        if (!reason) continue;
        await this.memoryService.retire(entry.id, null, reason);
        retired += 1;
        this.logger.info(
          `[BUG_HUNTER] Retired notebook entry ${entry.id}: ${reason}`,
        );
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] Could not evaluate notebook entry ${entry.id} for retirement: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (retired > 0) {
      this.logger.info(
        `[BUG_HUNTER] Notebook retirement pass: ${retired} of ${entries.length} active entries retired.`,
      );
    }
    return retired;
  }

  private async contextFor(
    entry: AgentMemory,
    now: Date,
  ): Promise<RetirementContext> {
    const repos = entry.repos?.length ? entry.repos : null;
    const [row] = (await this.runRepository.query(
      `SELECT COUNT(*)::int AS "count"
         FROM bug_hunt_runs r
        WHERE r."createdAt" > $1
          AND r.metadata ? 'memoryFeedback'
          AND ($2::text[] IS NULL OR r.repo = ANY($2::text[]))`,
      [entry.createdAt, repos],
    )) as Array<{ count: number }>;

    let finding: RetirementContext['finding'] = null;
    if (entry.findingId) {
      const found = await this.findingRepository.findOne({
        where: { id: entry.findingId },
      });
      if (found) {
        finding = {
          status: found.status,
          releasedAt: found.releasedAt ?? null,
          regressed: found.metadata?.regressed === true,
        };
      }
    }
    return { feedbackRunsSince: row?.count ?? 0, finding, now };
  }
}
