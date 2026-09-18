import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderReport } from '../entity/builder-report.entity';
import {
  BuilderBuildRunRepository,
  BuilderPullRequestRepository,
  BuilderReportRepository,
} from '../repository/builder-build.repository';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderLessonCategory, BuilderReportType } from '../enum/builder.enum';

/** Categories the agent may tag a retrospective bullet with. */
const LESSON_CATEGORIES = new Set<string>(Object.values(BuilderLessonCategory));

/**
 * The agent's account of its own work, plus the flywheel that turns each
 * run's retrospective into context for the next one.
 *
 * The event log says what happened; a report says what it *means*. Asking a
 * reviewer to reconstruct "what did this change and why" from four hundred
 * tool calls is not reasonable, and the PR body is written from this.
 */
@Injectable()
export class BuilderReportService {
  private readonly logger = LoggerService.getInstance(
    BuilderReportService.name,
  );

  constructor(
    private readonly reportRepository: BuilderReportRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly knowledgeService: BuilderKnowledgeService,
  ) {}

  /**
   * Store a report from the runner. A `retrospective` array in the metrics is
   * unpacked into builder_lessons — that is the whole compounding mechanism,
   * so it happens here rather than being left to a later pass that might not
   * run.
   */
  async recordFromRunner(params: {
    sessionId: string;
    runId: string;
    type?: string;
    contentMd: string;
    metrics?: Record<string, any> | null;
    repos?: string[];
  }): Promise<BuilderReport> {
    const type = Object.values(BuilderReportType).includes(
      params.type as BuilderReportType,
    )
      ? (params.type as BuilderReportType)
      : BuilderReportType.RUN_REPORT;

    const report = await this.reportRepository.save(
      this.reportRepository.create({
        sessionId: params.sessionId,
        runId: params.runId,
        type,
        contentMd: params.contentMd,
        metrics: params.metrics ?? null,
      }),
    );

    await this.harvestLessons(params.sessionId, params.metrics, params.repos);
    return report;
  }

  /**
   * Pull retrospective bullets out of a report's metrics and store them.
   *
   * Tolerant of shape on purpose: the agent writes this array itself, and a
   * lesson arriving as a bare string rather than `{category, lesson}` is
   * worth keeping — losing it to a schema quibble defeats the point.
   */
  private async harvestLessons(
    sessionId: string,
    metrics: Record<string, any> | null | undefined,
    repos?: string[],
  ): Promise<void> {
    const raw = metrics?.retrospective;
    if (!Array.isArray(raw) || !raw.length) return;

    for (const entry of raw.slice(0, 10)) {
      const text =
        typeof entry === 'string'
          ? entry
          : String(entry?.lesson ?? entry?.text ?? '');
      if (!text.trim()) continue;

      const rawCategory =
        typeof entry === 'object' ? String(entry?.category ?? '') : '';
      const category = LESSON_CATEGORIES.has(rawCategory)
        ? (rawCategory as BuilderLessonCategory)
        : BuilderLessonCategory.GOTCHA;

      const rawRepo = typeof entry === 'object' ? entry?.repo : undefined;
      const repo =
        typeof rawRepo === 'string' && rawRepo
          ? rawRepo
          : repos?.length === 1
            ? repos[0]
            : null;

      await this.knowledgeService.recordLesson({
        sessionId,
        repo,
        category,
        lesson: text.trim(),
      });
    }
    this.logger.info(
      `Builder session ${sessionId} contributed ${raw.length} lesson(s) to the library.`,
    );
  }

  /**
   * A session-level rollup composed from what actually happened, not asked of
   * the model: run outcomes, spend and PR links are facts ally-be already
   * holds, and asking an agent to restate them is a way to get them wrong.
   */
  async composeSessionReport(sessionId: string): Promise<BuilderReport> {
    const [runs, pullRequests, runReports] = await Promise.all([
      this.runRepository.listBySession(sessionId),
      this.pullRequestRepository.listBySession(sessionId),
      this.reportRepository.find({
        where: { sessionId, type: BuilderReportType.RUN_REPORT },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const totalCost = runs.reduce(
      (sum, run) => sum + Number(run.costUsd ?? 0),
      0,
    );
    const totalMinutes = runs.reduce(
      (sum, run) => sum + (run.runnerMinutes ?? 0),
      0,
    );

    const lines: string[] = [];
    lines.push(`## Runs\n`);
    for (const run of runs) {
      lines.push(
        `- Run ${run.sequence} (${run.mode}) — ${run.status.toLowerCase()}` +
          `${run.runnerMinutes ? `, ${run.runnerMinutes} min` : ''}` +
          `${run.costUsd ? `, $${Number(run.costUsd).toFixed(2)}` : ''}` +
          `${run.error ? ` — ${run.error}` : ''}`,
      );
    }

    if (pullRequests.length) {
      lines.push(`\n## Pull requests\n`);
      for (const pr of pullRequests) {
        lines.push(
          `- [${pr.repo} #${pr.prNumber}](${pr.prUrl})` +
            `${pr.merged ? ' — merged' : pr.ciStatus ? ` — CI ${pr.ciStatus}` : ' — open'}`,
        );
      }
    } else {
      lines.push(`\n## Pull requests\n\nNone opened.`);
    }

    lines.push(
      `\n## Totals\n\n${runs.length} run(s), ${totalMinutes} runner minute(s), $${totalCost.toFixed(2)} spent.`,
    );

    if (runReports.length) {
      lines.push(`\n## What the agent reported\n`);
      for (const report of runReports) {
        lines.push(`\n${report.contentMd}`);
      }
    }

    return this.reportRepository.save(
      this.reportRepository.create({
        sessionId,
        runId: null,
        type: BuilderReportType.SESSION_REPORT,
        contentMd: lines.join('\n'),
        metrics: {
          runs: runs.length,
          pullRequests: pullRequests.length,
          totalCostUsd: totalCost,
          runnerMinutes: totalMinutes,
        },
      }),
    );
  }

  listBySession(sessionId: string): Promise<BuilderReport[]> {
    return this.reportRepository.listBySession(sessionId);
  }
}
