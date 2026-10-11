import { Injectable } from '@nestjs/common';
import { In, MoreThanOrEqual } from 'typeorm';

import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHuntEventRepository } from '../repository/bug-hunt-event.repository';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';

/** One repo's day on the Work tab's board. Every count is for the calendar day in the caller's time zone, except `prsOpen`, which is the live number. */
export interface BugHunterTodayRepo {
  repo: string;
  sweeps: {
    completed: number;
    failed: number;
    skipped: number;
    running: number;
  };
  /** Findings filed today, by any sense or a person. */
  found: number;
  /** Independent verifier verdicts on findings today. */
  verified: number;
  refuted: number;
  /** Fix sessions started today: by a person from the tab, or by Bug Hunter itself (the verifier's confirmation, or the next step of a plan). */
  fixSessions: {
    byPerson: number;
    byAgent: number;
    running: number;
    failed: number;
  };
  /** Verifier verdicts on fix PRs today. */
  fixesPassed: number;
  fixesFailed: number;
  /** Fix PRs open right now, whatever day they were opened. */
  prsOpen: number;
  merged: number;
  released: number;
  spendUsd: number;
}

export interface BugHunterToday {
  date: string;
  timeZone: string;
  since: string;
  repos: BugHunterTodayRepo[];
  totals: Omit<BugHunterTodayRepo, 'repo'>;
}

const empty = (repo: string): BugHunterTodayRepo => ({
  repo,
  sweeps: { completed: 0, failed: 0, skipped: 0, running: 0 },
  found: 0,
  verified: 0,
  refuted: 0,
  fixSessions: { byPerson: 0, byAgent: 0, running: 0, failed: 0 },
  fixesPassed: 0,
  fixesFailed: 0,
  prsOpen: 0,
  merged: 0,
  released: 0,
  spendUsd: 0,
});

/**
 * The Work tab's "Today, by repo" board: what Bug Hunter did since midnight
 * in the team's time zone, one row per repo. Read from the rows the pipeline
 * already writes — runs, findings and the event timeline — with no new
 * storage, so it is correct the moment the tab loads and costs three
 * indexed reads.
 */
@Injectable()
export class BugHunterTodayService {
  constructor(
    private readonly runRepository: BugHuntRunRepository,
    private readonly findingRepository: BugFindingRepository,
    private readonly eventRepository: BugHuntEventRepository,
  ) {}

  async today(
    timeZone: string,
    now: Date = new Date(),
  ): Promise<BugHunterToday> {
    const since = startOfDayIn(timeZone, now);
    const rows = new Map<string, BugHunterTodayRepo>();
    for (const repo of Object.keys(BUG_HUNT_REPOS)) rows.set(repo, empty(repo));
    const row = (repo: string | null | undefined) => {
      const key = repo ?? '—';
      if (!rows.has(key)) rows.set(key, empty(key));
      return rows.get(key)!;
    };

    const [runs, findings, openPrs, events] = await Promise.all([
      this.runRepository.find({ where: { createdAt: MoreThanOrEqual(since) } }),
      this.findingRepository.find({
        where: { createdAt: MoreThanOrEqual(since) },
        select: ['id', 'repo', 'createdAt'],
      }),
      this.findingRepository.find({
        where: { status: BugFindingStatus.PR_OPENED },
        select: ['id', 'repo'],
      }),
      this.eventRepository.find({
        where: {
          createdAt: MoreThanOrEqual(since),
          stage: In([
            BugHuntEventStage.SESSION_DISPATCHED,
            BugHuntEventStage.STEP_STARTED,
            BugHuntEventStage.VERIFY,
            BugHuntEventStage.MERGED,
            BugHuntEventStage.RELEASED,
          ]),
        },
      }),
    ]);

    for (const run of runs) {
      const r = row(run.repo);
      const cost =
        Number(run.metadata?.cliReportedCostUsd) ||
        Number(run.totalTokenCostUsd) ||
        0;
      r.spendUsd += cost;
      if (
        run.trigger === BugHuntTrigger.SCHEDULED ||
        run.trigger === BugHuntTrigger.MANUAL
      ) {
        if (run.status === BugHuntRunStatus.COMPLETED) r.sweeps.completed += 1;
        else if (run.status === BugHuntRunStatus.FAILED) r.sweeps.failed += 1;
        else if (run.status === BugHuntRunStatus.RUNNING) r.sweeps.running += 1;
        else r.sweeps.skipped += 1;
      } else if (run.trigger === BugHuntTrigger.FIX_SESSION) {
        if (run.status === BugHuntRunStatus.RUNNING) r.fixSessions.running += 1;
        else if (run.status === BugHuntRunStatus.FAILED)
          r.fixSessions.failed += 1;
      }
    }
    for (const f of findings) row(f.repo).found += 1;
    for (const f of openPrs) row(f.repo).prsOpen += 1;

    for (const e of events) {
      const r = row(e.repo);
      const p = (e.payload ?? {}) as Record<string, any>;
      switch (e.stage) {
        case BugHuntEventStage.SESSION_DISPATCHED:
          if (typeof p.startedBy === 'number') r.fixSessions.byPerson += 1;
          else r.fixSessions.byAgent += 1;
          break;
        case BugHuntEventStage.STEP_STARTED:
          r.fixSessions.byAgent += 1;
          break;
        case BugHuntEventStage.VERIFY: {
          const verdict = p.verdict?.verdict;
          if (p.kind === 'finding') {
            if (verdict === 'confirmed') r.verified += 1;
            else if (verdict === 'refuted') r.refuted += 1;
          } else if (p.kind === 'fix') {
            if (verdict === 'pass') r.fixesPassed += 1;
            else if (verdict === 'fail') r.fixesFailed += 1;
          }
          break;
        }
        case BugHuntEventStage.MERGED:
          // Only the one event per merge that names a PR; the sweep also
          // reports a bare `merged` stage without a finding.
          if (e.findingId) r.merged += 1;
          break;
        case BugHuntEventStage.RELEASED:
          if (e.findingId) r.released += 1;
          break;
        default:
          break;
      }
    }

    const repos = [...rows.values()]
      .filter((r) => BUG_HUNT_REPOS[r.repo] || hasAnything(r))
      .sort((a, b) => a.repo.localeCompare(b.repo));
    const totals = repos.reduce<Omit<BugHunterTodayRepo, 'repo'>>(
      (t, r) => ({
        sweeps: {
          completed: t.sweeps.completed + r.sweeps.completed,
          failed: t.sweeps.failed + r.sweeps.failed,
          skipped: t.sweeps.skipped + r.sweeps.skipped,
          running: t.sweeps.running + r.sweeps.running,
        },
        found: t.found + r.found,
        verified: t.verified + r.verified,
        refuted: t.refuted + r.refuted,
        fixSessions: {
          byPerson: t.fixSessions.byPerson + r.fixSessions.byPerson,
          byAgent: t.fixSessions.byAgent + r.fixSessions.byAgent,
          running: t.fixSessions.running + r.fixSessions.running,
          failed: t.fixSessions.failed + r.fixSessions.failed,
        },
        fixesPassed: t.fixesPassed + r.fixesPassed,
        fixesFailed: t.fixesFailed + r.fixesFailed,
        prsOpen: t.prsOpen + r.prsOpen,
        merged: t.merged + r.merged,
        released: t.released + r.released,
        spendUsd: round(t.spendUsd + r.spendUsd),
      }),
      emptyTotals(),
    );
    for (const r of repos) r.spendUsd = round(r.spendUsd);

    return {
      date: dateIn(timeZone, now),
      timeZone,
      since: since.toISOString(),
      repos,
      totals,
    };
  }
}

const emptyTotals = (): Omit<BugHunterTodayRepo, 'repo'> => {
  const { repo, ...rest } = empty('');
  void repo;
  return rest;
};

const hasAnything = (r: BugHunterTodayRepo): boolean =>
  r.found +
    r.prsOpen +
    r.merged +
    r.released +
    r.spendUsd +
    r.sweeps.completed +
    r.sweeps.failed +
    r.sweeps.running +
    r.sweeps.skipped +
    r.fixSessions.byPerson +
    r.fixSessions.byAgent >
  0;

const round = (n: number): number => Math.round(n * 100) / 100;

/** `YYYY-MM-DD` of `now` in the given zone. */
export function dateIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The UTC instant of local midnight in the given zone, for the day `now` falls on there. */
export function startOfDayIn(timeZone: string, now: Date): Date {
  const [y, m, d] = dateIn(timeZone, now).split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // The zone's offset at that instant, read from the zone's own wall clock
  // rather than by parsing a localised string, which would be interpreted
  // in the process's time zone and give the wrong answer on any machine not
  // set to UTC.
  return new Date(utcMidnight - zoneOffsetMs(timeZone, new Date(utcMidnight)));
}

/** Milliseconds the zone's wall clock is ahead of UTC at `instant`. */
export function zoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - instant.getTime();
}
