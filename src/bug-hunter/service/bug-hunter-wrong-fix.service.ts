import { Injectable } from '@nestjs/common';
import { In, MoreThanOrEqual } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  BUG_CHAIN_LINK_WORDS,
  BugChainLink,
} from '../type/bug-case-chain.type';
import {
  BUG_WRONG_FIX_SOURCES,
  BugWrongFix,
  BugWrongFixSource,
  wrongFixOf,
} from '../type/bug-wrong-fix.type';
import { BugHunterService } from './bug-hunter.service';

export interface WrongFixSummary {
  windowDays: number;
  since: string;
  total: number;
  byLink: Record<BugChainLink, number>;
  bySource: Record<BugWrongFixSource, number>;
  recent: {
    findingId: string;
    title: string;
    repo: string | null;
    link: BugChainLink;
    source: BugWrongFixSource;
    reason: string;
    prUrl: string | null;
    at: string;
  }[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Writes the wrong-fix record and the lesson that goes with it — see
 * `BugWrongFix`. One place, so every way a fix turns out wrong leaves the
 * same three things behind: the row (which link), a notebook entry a future
 * session reads before it repeats the approach, and the bug back on the
 * board when the fix is no longer on master or no longer holds.
 */
@Injectable()
export class BugHunterWrongFixService {
  private readonly logger = LoggerService.getInstance(
    BugHunterWrongFixService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly bugHunterService: BugHunterService,
    private readonly memoryService: AgentMemoryService,
  ) {}

  /**
   * Best-effort: a record that cannot be written must not fail the verdict,
   * the reconcile or the sweep that found the problem.
   */
  async record(
    finding: BugFinding,
    wrongFix: Omit<BugWrongFix, 'at'>,
    options: { reopen: boolean },
  ): Promise<void> {
    try {
      const row: BugWrongFix = { ...wrongFix, at: new Date().toISOString() };
      const fresh = await this.findingRepository.findOne({
        where: { id: finding.id },
      });
      const metadata = { ...(fresh?.metadata ?? finding.metadata ?? {}) };
      await this.findingRepository.update(finding.id, {
        metadata: { ...metadata, wrongFix: row } as Record<string, any>,
        ...(options.reopen ? { status: BugFindingStatus.NEW } : {}),
      });
      await this.bugHunterService.appendFindingEvent({
        findingId: finding.id,
        repo: finding.repo,
        stage: BugHuntEventStage.WRONG_FIX,
        summary: `${this.describe(row)}${options.reopen ? ' — reopened; the next attempt reads this first.' : ''}`,
        payload: { wrongFix: row, reopened: options.reopen },
      });
      await this.memoryService.write({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: this.lesson(finding, row),
        repos: finding.repo ? [finding.repo] : null,
        tags: ['wrong-fix', 'fix-gotcha', `link:${row.link}`],
        findingId: finding.id,
        pinned: false,
      });
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not record the wrong fix on ${finding.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private describe(w: BugWrongFix): string {
    const link = BUG_CHAIN_LINK_WORDS[w.link];
    switch (w.source) {
      case 'revert':
        return `A person reverted my fix (${w.prUrl ?? 'the PR'}${w.by ? `, ${w.by}` : ''}): the chain broke at "${link}". ${w.reason}`;
      case 'regression':
        return `My fix did not hold — the bug came back: the chain broke at "${link}". ${w.reason}`;
      case 'held_check':
        return `I re-checked production after the release and the symptom is back: the chain broke at "${link}". ${w.reason}`;
      default:
        return `The Verifier found my fix wrong at "${link}". ${w.reason}`;
    }
  }

  /** Under 600 characters, written for a stranger — the notebook's rule. */
  private lesson(finding: BugFinding, w: BugWrongFix): string {
    const head = `Wrong fix on "${finding.title.slice(0, 90)}"${finding.repo ? ` (${finding.repo})` : ''}: the chain broke at "${BUG_CHAIN_LINK_WORDS[w.link]}" (${w.source}).`;
    const why = ` ${w.reason}`.slice(0, 330);
    const rule =
      w.link === 'changed' || w.link === 'located'
        ? ' Before fixing a bug like this, locate the fault in production first and change that layer; a code change in the wrong layer passes every test and fixes nothing.'
        : w.link === 'resolved' || w.link === 'held'
          ? " A green regression test is not the symptom gone: re-run the reporter's steps at the PR head and again after release."
          : ' Check the evidence on every link of the chain before merging.';
    return `${head}${why}${rule}`.slice(0, 600);
  }

  /** The wrong-fix table for a window: counts per broken link and per source, with the recent rows. */
  async summary(days: number): Promise<WrongFixSummary> {
    const since = new Date(Date.now() - days * MS_PER_DAY);
    const rows = await this.findingRepository.find({
      where: { updatedAt: MoreThanOrEqual(since) },
      select: ['id', 'title', 'repo', 'metadata', 'updatedAt'],
    });
    const byLink = Object.fromEntries(
      Object.keys(BUG_CHAIN_LINK_WORDS).map((k) => [k, 0]),
    ) as Record<BugChainLink, number>;
    const bySource = Object.fromEntries(
      BUG_WRONG_FIX_SOURCES.map((s) => [s, 0]),
    ) as Record<BugWrongFixSource, number>;
    const recent: WrongFixSummary['recent'] = [];
    for (const f of rows) {
      const w = wrongFixOf(f.metadata);
      if (!w || !w.at || new Date(w.at) < since) continue;
      byLink[w.link] = (byLink[w.link] ?? 0) + 1;
      bySource[w.source] = (bySource[w.source] ?? 0) + 1;
      recent.push({
        findingId: f.id,
        title: f.title,
        repo: f.repo ?? null,
        link: w.link,
        source: w.source,
        reason: w.reason,
        prUrl: w.prUrl,
        at: w.at,
      });
    }
    recent.sort((a, b) => b.at.localeCompare(a.at));
    return {
      windowDays: days,
      since: since.toISOString(),
      total: recent.length,
      byLink,
      bySource,
      recent: recent.slice(0, 50),
    };
  }

  /** Findings whose shipped fix is on master, by PR number in a repo — the revert watch's lookup. */
  async findShippedByPr(
    repo: string,
    prNumber: number,
  ): Promise<BugFinding | null> {
    const candidates = await this.findingRepository.find({
      where: {
        repo,
        status: In([
          BugFindingStatus.MERGED,
          BugFindingStatus.RELEASING,
          BugFindingStatus.RELEASED,
          BugFindingStatus.RELEASE_FAILED,
        ]),
      },
      order: { updatedAt: 'DESC' },
      take: 200,
    });
    return (
      candidates.find((f) =>
        new RegExp(`/pull/${prNumber}(?:$|[^0-9])`).test(f.prUrl ?? ''),
      ) ?? null
    );
  }
}
