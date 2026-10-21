import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PromptsService } from 'src/prompt/service/prompt.service';
import { BuilderEvalSuite } from '../../entity/builder-eval-suite.entity';
import { BuilderEvalRun } from '../../entity/builder-eval-run.entity';
import { BuilderEvalFixture } from '../../entity/builder-eval-fixture.entity';
import { isBuilderEvalGatedPrompt } from '../../constants/builder-eval-gate.constants';
import {
  BUILDER_EVAL_BASELINE_MAX_AGE_MS,
  BUILDER_EVAL_CONCURRENCY,
  BUILDER_EVAL_JUDGE_TOLERANCE,
  BUILDER_EVAL_MAX_RUNNING_SUITES,
  BUILDER_EVAL_HEARTBEAT_MS,
  BUILDER_EVAL_MAX_RESUMES,
  BUILDER_EVAL_STALL_MS,
} from '../constants/builder-eval-prompts';
import {
  BuilderEvalOverrides,
  BuilderEvalPromptCandidate,
  BuilderEvalSuiteSummary,
  BuilderEvalSuiteTrigger,
  BuilderEvalVerdict,
} from '../type/builder-eval.type';
import { gateViolations } from '../util/builder-eval-scoring.util';
import { BuilderEvalFixtureService } from './builder-eval-fixture.service';
import { BuilderEvalRunnerService } from './builder-eval-runner.service';
import { BuilderSettingsService } from '../../service/builder-settings.service';

const DEFAULT_REPETITIONS = 3;

/**
 * The loop a suite ran: validated turns or not, and with them the interview
 * protocol or not. Suites from before either switch existed ran without it.
 */
const loopOf = (overrides: BuilderEvalOverrides | null | undefined): string => {
  const validated = overrides?.validatedTurns === true;
  if (!validated) return 'legacy';
  return overrides?.situationBrief === true ? 'validated+brief' : 'validated';
};

/** Roll a suite's runs up per fixture and overall. Pure, for the gate and the page. */
export function summariseSuite(
  fixtures: BuilderEvalFixture[],
  runs: BuilderEvalRun[],
): BuilderEvalSuiteSummary {
  const byFixture = fixtures.map((fixture) => {
    const mine = runs.filter((run) => run.fixtureId === fixture.id);
    const judged = mine
      .map((run) => run.judge)
      .filter((judge) => judge && judge.total > 0) as { score: number }[];
    return {
      fixtureId: fixture.id,
      name: fixture.name,
      kind: fixture.kind,
      runs: mine.length,
      passed: mine.filter((run) => run.status === 'passed').length,
      gateViolations: mine.reduce(
        (sum, run) => sum + gateViolations(run.gates),
        0,
      ),
      corrections: mine.reduce(
        (sum, run) => sum + (run.metrics?.corrections ?? 0),
        0,
      ),
      judgeScore: judged.length
        ? judged.reduce((sum, judge) => sum + judge.score, 0) / judged.length
        : null,
    };
  });
  const judgedRuns = runs.filter((run) => run.judge && run.judge.total > 0);
  return {
    fixtures: byFixture,
    runs: runs.length,
    passed: runs.filter((run) => run.status === 'passed').length,
    errored: runs.filter((run) => run.status === 'errored').length,
    gateViolations: byFixture.reduce((sum, row) => sum + row.gateViolations, 0),
    corrections: byFixture.reduce((sum, row) => sum + row.corrections, 0),
    judgeScore: judgedRuns.length
      ? judgedRuns.reduce((sum, run) => sum + (run.judge?.score ?? 0), 0) /
        judgedRuns.length
      : null,
    costUsd:
      Math.round(
        runs.reduce((sum, run) => sum + (run.metrics?.costUsd ?? 0), 0) * 100,
      ) / 100,
  };
}

/**
 * Whether a candidate is no worse than the baseline on the same fixtures.
 *
 * Relative, not absolute, on purpose: today's interviewer fails these
 * fixtures (that is what they were chosen for), so an absolute bar would
 * refuse every prompt edit, including the ones that improve it. A candidate
 * passes when it makes nothing measurably worse — gate violations and
 * corrections may not rise, the judge's mean may not fall past a tolerance,
 * the critic may not miss more seeded defects — and when every run finished,
 * because a comparison with holes in it is not one.
 */
export function compareSuites(
  candidate: BuilderEvalSuiteSummary,
  baseline: BuilderEvalSuiteSummary,
  baselineSuiteId: string,
): BuilderEvalVerdict {
  const ids = new Set(candidate.fixtures.map((row) => row.fixtureId));
  const base = baseline.fixtures.filter((row) => ids.has(row.fixtureId));
  const sum = (
    rows: typeof base,
    pick: (row: (typeof base)[number]) => number,
  ) => rows.reduce((total, row) => total + pick(row), 0);
  const reasons: string[] = [];
  let pass = true;

  if (candidate.errored > 0) {
    pass = false;
    reasons.push(
      `${candidate.errored} run(s) errored, so the comparison would have holes in it.`,
    );
  }
  const gatesNow = candidate.gateViolations;
  const gatesBefore = sum(base, (row) => row.gateViolations);
  if (gatesNow > gatesBefore) {
    pass = false;
    reasons.push(`Gate violations rose from ${gatesBefore} to ${gatesNow}.`);
  } else {
    reasons.push(`Gate violations ${gatesNow} (baseline ${gatesBefore}).`);
  }
  const correctionsNow = candidate.corrections;
  const correctionsBefore = sum(base, (row) => row.corrections);
  if (correctionsNow > correctionsBefore) {
    pass = false;
    reasons.push(
      `Simulated admin corrections rose from ${correctionsBefore} to ${correctionsNow}.`,
    );
  } else {
    reasons.push(
      `Corrections ${correctionsNow} (baseline ${correctionsBefore}).`,
    );
  }
  const judgedBase = base.filter((row) => row.judgeScore !== null);
  const judgeBefore = judgedBase.length
    ? sum(judgedBase, (row) => row.judgeScore ?? 0) / judgedBase.length
    : null;
  if (candidate.judgeScore !== null && judgeBefore !== null) {
    if (candidate.judgeScore < judgeBefore - BUILDER_EVAL_JUDGE_TOLERANCE) {
      pass = false;
      reasons.push(
        `Checklist score fell from ${judgeBefore.toFixed(2)} to ${candidate.judgeScore.toFixed(2)}.`,
      );
    } else {
      reasons.push(
        `Checklist score ${candidate.judgeScore.toFixed(2)} (baseline ${judgeBefore.toFixed(2)}).`,
      );
    }
  }
  const criticNow = sum(
    candidate.fixtures.filter((row) => row.kind === 'prd_review'),
    (row) => row.passed,
  );
  const criticBefore = sum(
    base.filter((row) => row.kind === 'prd_review'),
    (row) => row.passed,
  );
  if (criticNow < criticBefore) {
    pass = false;
    reasons.push(
      `The critic got ${criticBefore - criticNow} fewer PRD checks right.`,
    );
  }
  return { pass, reasons, baselineSuiteId };
}

/**
 * Runs eval suites, and gates Builder prompt changes on them.
 *
 * A suite runs in the background of this process — a replay is a full
 * interview and a suite is dozens of them — with a small worker pool. A
 * restart cuts it off; the next read of the suite list marks one that has not
 * moved in a while as errored rather than leaving it "running" forever.
 *
 * A prompt-gate suite plays the candidate prompt or model settings against
 * the fixtures and compares it with a baseline on the live settings (reused if
 * a recent one exists, run alongside otherwise). It publishes the change
 * through the prompts service on a pass, and on a fail publishes nothing.
 */
@Injectable()
export class BuilderEvalService {
  private readonly logger = LoggerService.getInstance(BuilderEvalService.name);
  private readonly suites: Repository<BuilderEvalSuite>;
  private readonly runs: Repository<BuilderEvalRun>;
  /** Suites this process is running, so a gate can wait on its baseline. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly fixtureService: BuilderEvalFixtureService,
    private readonly runner: BuilderEvalRunnerService,
    private readonly promptsService: PromptsService,
    private readonly settingsService: BuilderSettingsService,
  ) {
    this.suites = dataSource.getRepository(BuilderEvalSuite);
    this.runs = dataSource.getRepository(BuilderEvalRun);
  }

  async startSuite(input: {
    trigger: BuilderEvalSuiteTrigger;
    fixtureIds?: string[];
    repetitions?: number;
    overrides?: BuilderEvalOverrides | null;
    candidate?: BuilderEvalPromptCandidate | null;
    userId: number;
    /** A gate's own baseline: part of a suite already admitted, so not counted again. */
    baselineFor?: string;
  }): Promise<BuilderEvalSuite> {
    await this.resumeStalled();
    const running = await this.suites.count({ where: { status: 'running' } });
    if (!input.baselineFor && running >= BUILDER_EVAL_MAX_RUNNING_SUITES) {
      throw new ConflictException(
        `${running} eval suites are already running. Each one is dozens of full ` +
          'interviews — wait for one to finish.',
      );
    }
    const fixtures = input.fixtureIds?.length
      ? await this.fixtureService.findMany(input.fixtureIds)
      : await this.fixtureService.listActive();
    if (!fixtures.length) {
      throw new BadRequestException(
        'No fixtures to run. Save a session as an eval fixture first.',
      );
    }
    const repetitions = Math.min(
      10,
      Math.max(1, Math.round(input.repetitions ?? DEFAULT_REPETITIONS)),
    );
    // The loop is part of what a suite measured — stamped now, from the live
    // switch unless the caller chose, so the record says which loop ran.
    const live = await this.liveLoop();
    const overrides: BuilderEvalOverrides = {
      ...(input.overrides ?? {}),
      validatedTurns: input.overrides?.validatedTurns ?? live.validatedTurns,
      situationBrief: input.overrides?.situationBrief ?? live.situationBrief,
    };

    const suite = await this.suites.save(
      this.suites.create({
        trigger: input.trigger,
        status: 'running',
        fixtureIds: fixtures.map((fixture) => fixture.id),
        repetitions,
        overrides,
        candidate: input.candidate ?? null,
        createdBy: input.userId,
      }),
    );
    await this.runs.save(
      fixtures.flatMap((fixture) =>
        Array.from({ length: repetitions }, (_, index) =>
          this.runs.create({
            suiteId: suite.id,
            fixtureId: fixture.id,
            repetition: index + 1,
            status: 'queued',
          }),
        ),
      ),
    );

    const work = this.execute(suite.id, fixtures).finally(() =>
      this.inflight.delete(suite.id),
    );
    this.inflight.set(suite.id, work);
    void work;
    return suite;
  }

  /**
   * A proposed change to a gated Builder prompt: run it against the fixtures
   * and publish it only if it is no worse than what is live.
   */
  async submitPromptCandidate(
    candidate: BuilderEvalPromptCandidate,
    userId: number,
    options: { fixtureIds?: string[]; repetitions?: number } = {},
  ): Promise<BuilderEvalSuite> {
    if (!isBuilderEvalGatedPrompt(candidate.promptCode)) {
      throw new BadRequestException(
        `${candidate.promptCode} is not a gated Builder prompt; edit it in the prompt editor.`,
      );
    }
    const content = candidate.content?.trim() || null;
    const changesModel =
      candidate.model !== undefined ||
      candidate.provider !== undefined ||
      candidate.temperature !== undefined;
    if (!content && !changesModel) {
      throw new BadRequestException(
        'Nothing to try: give new text or model settings.',
      );
    }
    const pendingSameCode = await this.suites
      .createQueryBuilder('suite')
      .where('suite.trigger = :trigger', { trigger: 'prompt_gate' })
      .andWhere('suite.status = :status', { status: 'running' })
      .andWhere(`suite.candidate ->> 'promptCode' = :code`, {
        code: candidate.promptCode,
      })
      .getCount();
    if (pendingSameCode) {
      throw new ConflictException(
        `A change to ${candidate.promptCode} is already being evaluated. Wait for its verdict.`,
      );
    }

    const overrides: BuilderEvalOverrides = {
      ...(content ? { prompts: { [candidate.promptCode]: content } } : {}),
      ...(changesModel
        ? {
            llmConfig: {
              [candidate.promptCode]: {
                ...(candidate.provider !== undefined
                  ? { provider: candidate.provider }
                  : {}),
                ...(candidate.model !== undefined
                  ? { model: candidate.model }
                  : {}),
                ...(candidate.temperature !== undefined
                  ? { temperature: candidate.temperature }
                  : {}),
              },
            },
          }
        : {}),
    };
    return this.startSuite({
      trigger: 'prompt_gate',
      fixtureIds: options.fixtureIds,
      repetitions: options.repetitions,
      overrides,
      candidate: { ...candidate, content },
      userId,
    });
  }

  /**
   * Stop a running suite. Runs not yet started are marked cancelled; a run
   * already in flight finishes and keeps its result (a replay cannot be
   * stopped mid-turn without leaving its sandbox half-written, and it is
   * minutes at most). A cancelled prompt-gate suite publishes nothing.
   */
  async cancelSuite(id: string, userId: number): Promise<BuilderEvalSuite> {
    const suite = await this.suites.findOne({ where: { id } });
    if (!suite) throw new NotFoundException('No such eval suite.');
    const cancelled = await this.suites.update(
      { id, status: 'running' },
      {
        status: 'cancelled',
        error: `Cancelled by admin ${userId}.`,
        completedAt: new Date(),
      },
    );
    if (!cancelled.affected) {
      throw new BadRequestException(
        `That suite is ${suite.status}, not running — nothing to cancel.`,
      );
    }
    await this.runs.update(
      { suiteId: id, status: 'queued' },
      { status: 'cancelled' },
    );
    this.logger.info(`[BUILDER_EVAL] suite ${id} cancelled by ${userId}`);
    return this.suites.findOneOrFail({ where: { id } });
  }

  private async stillRunning(suiteId: string): Promise<boolean> {
    const current = await this.suites.findOne({
      where: { id: suiteId },
      select: { id: true, status: true },
    });
    return current?.status === 'running';
  }

  async listSuites(limit = 30): Promise<BuilderEvalSuite[]> {
    await this.resumeStalled();
    return this.suites.find({
      order: { createdAt: 'DESC' },
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  async getSuite(
    id: string,
  ): Promise<BuilderEvalSuite & { runs: BuilderEvalRun[] }> {
    const suite = await this.suites.findOne({ where: { id } });
    if (!suite) throw new NotFoundException('No such eval suite.');
    const runs = await this.runs.find({
      where: { suiteId: id },
      order: { fixtureId: 'ASC', repetition: 'ASC' },
    });
    return { ...suite, runs };
  }

  async getRun(id: string): Promise<BuilderEvalRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('No such eval run.');
    return run;
  }

  private async execute(
    suiteId: string,
    fixtures: BuilderEvalFixture[],
  ): Promise<void> {
    const suite = await this.suites.findOneOrFail({ where: { id: suiteId } });
    // The heartbeat is what lets another task tell a slow suite from one whose
    // process is gone; touching the row bumps updatedAt.
    const heartbeat = setInterval(() => {
      void this.suites
        .update({ id: suiteId, status: 'running' }, { status: 'running' })
        .catch(() => undefined);
    }, BUILDER_EVAL_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      // The gate's baseline runs beside the candidate, not before it: the two
      // take the same time, and waiting would double how long an admin waits
      // for a verdict.
      const baselinePromise =
        suite.trigger === 'prompt_gate'
          ? this.resolveBaseline(suite)
          : Promise.resolve(null);
      await this.runQueued(suite, fixtures);

      const runs = await this.runs.find({ where: { suiteId } });
      const summary = summariseSuite(fixtures, runs);
      let verdict: BuilderEvalVerdict | null = null;
      if (suite.trigger === 'prompt_gate') {
        const baseline = await baselinePromise;
        verdict = baseline?.summary
          ? compareSuites(summary, baseline.summary, baseline.id)
          : {
              pass: false,
              reasons: ['No baseline could be run to compare against.'],
              baselineSuiteId: baseline?.id ?? null,
            };
      }
      // Only a suite still running completes. A cancelled one keeps its status
      // and gets the summary of what did run — and never publishes: a gate
      // someone stopped has not passed.
      const completed = await this.suites.update(
        { id: suiteId, status: 'running' },
        { status: 'completed', summary, verdict, completedAt: new Date() },
      );
      if (!completed.affected) {
        await this.suites.update({ id: suiteId }, { summary });
        this.logger.info(
          `[BUILDER_EVAL] suite ${suiteId} stopped before finishing: ${summary.runs} run(s) recorded.`,
        );
        return;
      }
      if (verdict?.pass && suite.candidate) {
        await this.publish(suite);
      }
      this.logger.info(
        `[BUILDER_EVAL] suite ${suiteId} (${suite.trigger}) done: ${summary.passed}/${summary.runs} ` +
          `passed, ${summary.gateViolations} gate violation(s), ${summary.corrections} ` +
          `correction(s), ~$${summary.costUsd}${verdict ? `, verdict ${verdict.pass ? 'PASS' : 'FAIL'}` : ''}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[BUILDER_EVAL] suite ${suiteId} errored: ${message}`);
      await this.suites.update(
        { id: suiteId },
        {
          status: 'errored',
          error: message.slice(0, 2000),
          completedAt: new Date(),
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** The queued runs, a few at a time, each saved as it lands. */
  private async runQueued(
    suite: BuilderEvalSuite,
    fixtures: BuilderEvalFixture[],
  ): Promise<void> {
    const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const queue = await this.runs.find({
      where: { suiteId: suite.id, status: 'queued' },
      order: { repetition: 'ASC' },
    });
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const fixture = byId.get(next.fixtureId);
        if (!fixture) continue;
        // Cancelled (or settled elsewhere) since this queue was read: take no
        // more runs. The one another worker has in flight finishes and records.
        if (!(await this.stillRunning(suite.id))) return;
        await this.runs.update(
          { id: next.id },
          { status: 'running', startedAt: new Date() },
        );
        const result = await this.runner.run(fixture, {
          evalRunId: next.id,
          userId: suite.createdBy ?? 0,
          overrides: suite.overrides,
        });
        await this.runs.update(
          { id: next.id },
          { ...result, completedAt: new Date() },
        );
        // Touch the suite, which is what tells a stalled suite from a slow one.
        // Only while it is still running — a blind write here would undo a
        // cancel that landed during the run.
        await this.suites.update(
          { id: suite.id, status: 'running' },
          { status: 'running' },
        );
      }
    };
    await Promise.all(
      Array.from({ length: BUILDER_EVAL_CONCURRENCY }, () => worker()),
    );
  }

  /** The live interview switches; a failed read means the column defaults, on. */
  private async liveLoop(): Promise<{
    validatedTurns: boolean;
    situationBrief: boolean;
  }> {
    try {
      const settings = await this.settingsService.get();
      return {
        validatedTurns: settings.validatedTurns !== false,
        situationBrief: settings.situationBrief === true,
      };
    } catch {
      return { validatedTurns: true, situationBrief: true };
    }
  }

  /**
   * A recent completed run of the same fixtures on the live settings, or a
   * fresh one started now and awaited.
   */
  private async resolveBaseline(
    suite: BuilderEvalSuite,
  ): Promise<BuilderEvalSuite | null> {
    const since = new Date(Date.now() - BUILDER_EVAL_BASELINE_MAX_AGE_MS);
    const recent = await this.suites.find({
      where: {
        trigger: In(['baseline', 'manual']),
        status: 'completed',
        repetitions: suite.repetitions,
      },
      order: { completedAt: 'DESC' },
      take: 20,
    });
    // Same loop as the candidate, and nothing else overridden: a baseline
    // from the other loop would credit (or blame) the prompt for the loop.
    const loop = loopOf(suite.overrides);
    const reusable = recent.find(
      (candidate) =>
        (candidate.completedAt ?? new Date(0)) >= since &&
        !candidate.overrides?.prompts &&
        !candidate.overrides?.llmConfig &&
        loopOf(candidate.overrides) === loop &&
        !!candidate.summary &&
        suite.fixtureIds.every((id) => candidate.fixtureIds.includes(id)),
    );
    if (reusable) return reusable;

    const baseline = await this.startSuite({
      trigger: 'baseline',
      fixtureIds: suite.fixtureIds,
      repetitions: suite.repetitions,
      overrides: {
        validatedTurns: suite.overrides?.validatedTurns === true,
        situationBrief: suite.overrides?.situationBrief === true,
      },
      userId: suite.createdBy ?? 0,
      baselineFor: suite.id,
    }).catch((error: unknown) => {
      this.logger.warn(
        `[BUILDER_EVAL] baseline for ${suite.id} could not start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    });
    if (!baseline) return null;
    await this.inflight.get(baseline.id);
    return this.suites.findOne({ where: { id: baseline.id } });
  }

  /**
   * Put a passed candidate live, through the same path an admin's edit takes —
   * versioning, variable reconcile, translation — as the person who proposed it.
   */
  private async publish(suite: BuilderEvalSuite): Promise<void> {
    const candidate = suite.candidate!;
    try {
      await ExecutionManager.runWithContext(
        async () => {
          ExecutionManager.setAuthContext(String(suite.createdBy ?? 0), '');
          const promptId = await this.promptsService.findIdByCode(
            candidate.promptCode,
          );
          if (!promptId)
            throw new Error(`No prompt with code ${candidate.promptCode}.`);
          await this.promptsService.updatePrompt(
            promptId,
            {
              ...(candidate.content
                ? { prompt: candidate.content, useDashboardOverride: true }
                : {}),
              ...(candidate.provider !== undefined
                ? { provider: candidate.provider ?? '' }
                : {}),
              ...(candidate.model !== undefined
                ? { model: candidate.model ?? '' }
                : {}),
              // null clears the row's override, as it does from the editor.
              ...(candidate.temperature !== undefined
                ? { temperature: candidate.temperature }
                : {}),
            } as any,
            { evalApproved: true },
          );
        },
        { path: '/builder/eval/publish' },
      );
      await this.suites.update({ id: suite.id }, { publishedAt: new Date() });
      this.logger.info(
        `[BUILDER_EVAL] published ${candidate.promptCode} from suite ${suite.id}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[BUILDER_EVAL] publishing suite ${suite.id} failed: ${message}`,
      );
      await this.suites.update(
        { id: suite.id },
        { error: `Passed, but publishing failed: ${message}`.slice(0, 2000) },
      );
    }
  }

  /**
   * Pick up suites whose process went away — a deploy replaces every task, and
   * on 2026-10-21 one cut off the first production baseline after 5 of 63
   * runs. A suite with no heartbeat for BUILDER_EVAL_STALL_MS is claimed by
   * exactly one process (an atomic UPDATE … WHERE updatedAt < cutoff), its
   * half-done runs go back in the queue, and it carries on here. Finished runs
   * are kept. After BUILDER_EVAL_MAX_RESUMES it is called errored instead, so a
   * suite that kills its own process cannot loop.
   *
   * Runs on the 5-minute scheduler and before a suite is listed or started.
   */
  async resumeStalled(): Promise<void> {
    const cutoff = new Date(Date.now() - BUILDER_EVAL_STALL_MS);
    const stalled = await this.suites.find({
      where: { status: 'running', updatedAt: LessThan(cutoff) },
    });
    for (const suite of stalled) {
      if (this.inflight.has(suite.id)) continue;
      const result = await this.dataSource.query(
        `UPDATE "builder_eval_suites"
            SET "updatedAt" = now(), "resumeCount" = "resumeCount" + 1
          WHERE id = $1 AND status = 'running' AND "updatedAt" < $2
          RETURNING "resumeCount"`,
        [suite.id, cutoff],
      );
      const rows: { resumeCount: number }[] = Array.isArray(result?.[0])
        ? result[0]
        : result;
      // Another process got there first.
      if (!rows?.length) continue;
      const resumeCount = Number(rows[0].resumeCount);

      if (resumeCount > BUILDER_EVAL_MAX_RESUMES) {
        await this.suites.update(
          { id: suite.id },
          {
            status: 'errored',
            error: `Cut off ${resumeCount} times — giving up rather than resuming again.`,
            completedAt: new Date(),
          },
        );
        await this.runs.update(
          { suiteId: suite.id, status: In(['queued', 'running']) },
          { status: 'errored', error: 'The suite was cut off.' },
        );
        continue;
      }

      // A run that was mid-flight when the process died has no result; it
      // starts again from the top.
      await this.runs.update(
        { suiteId: suite.id, status: 'running' },
        { status: 'queued', startedAt: null },
      );
      const fixtures = await this.fixtureService.findMany(suite.fixtureIds);
      this.logger.warn(
        `[BUILDER_EVAL] suite ${suite.id} lost its process; resuming here (resume ${resumeCount}).`,
      );
      const work = this.execute(suite.id, fixtures).finally(() =>
        this.inflight.delete(suite.id),
      );
      this.inflight.set(suite.id, work);
      void work;
    }
  }
}
