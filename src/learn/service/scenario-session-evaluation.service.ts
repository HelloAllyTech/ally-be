import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AiService } from 'src/ai/service/ai.service';
import { ActorGoalEvaluationTurn } from 'src/ai/dto/ai.request.dto';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { AgentTestCaseService } from './agent-test-case.service';
import { UpdateActorEvaluationDto } from '../dto/scenario-session-evaluation.dto';

/** Lifecycle states stored in scenario_session_details.evaluationStatus. */
export enum ActorEvaluationStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * How far back the catch-up looks. Generous overlap (vs the 30-minute tick) so
 * nothing is lost if a tick is skipped or a session lands late — the
 * `evaluationStatus IS NULL` filter makes re-scanning the window free.
 */
const CATCHUP_WINDOW_HOURS = 24;

/**
 * Sessions ending inside this grace period are left alone: `end-of-session`
 * travels over SQS and the normal trigger may still be in flight. Only
 * genuinely missed sessions should reach the catch-up.
 */
const CATCHUP_GRACE_MINUTES = 15;

/**
 * Ceiling per tick, so a long outage drains gradually instead of firing a
 * day's backlog of judges at ai-learn in one burst. A full batch is logged, not
 * silently truncated.
 */
const CATCHUP_BATCH_LIMIT = 50;

/**
 * How long the V2V fast path waits after the tester's `end-v2v` webhook before
 * judging, so trailing transcript turns have landed.
 *
 * The agent's chat messages travel over SQS independently of the end signal and
 * arrive AFTER it. Measured on a real prod run (session
 * 6e0150c5, 2026-08-26): room finished at 04:52:44, a COUNSELOR turn landed at
 * 04:52:50 (+6s) and the session memory at 04:53:00 (+16s). Judging at t=0
 * would score a transcript missing its final turns — worse than judging late,
 * because the result looks complete.
 *
 * 20s clears the observed tail with headroom while still turning a 15-45 minute
 * wait into well under a minute.
 */
const V2V_EVALUATION_SETTLE_MS = 20_000;

/**
 * Goal-based evaluation of the roleplay ACTOR agent for a REAL session.
 *
 * On session end, {@link triggerForSession} fires an async ai-learn job that
 * runs an LLM judge over the transcript, scoring the actor against every
 * superadmin-configured agent test case. ai-learn then webhooks the result
 * back to {@link applyResult}, which persists per-goal scores + a composite +
 * markdown onto `scenario_session_details`.
 *
 * Entirely best-effort: a failure here never affects the session-end flow.
 */
@Injectable()
export class ScenarioSessionEvaluationService {
  private readonly logger = LoggerService.getInstance(
    ScenarioSessionEvaluationService.name,
  );

  constructor(
    private readonly scenarioSessionDetailsRepository: ScenarioSessionDetailsRepository,
    private readonly scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private readonly agentTestCaseService: AgentTestCaseService,
    private readonly aiService: AiService,
    private readonly scenarioSessionRepository: ScenarioSessionRepository,
  ) {}

  /**
   * Catch-up pass for sessions the normal trigger never saw.
   *
   * The judge only fires from `handleEndScenarioSessionEvent`, i.e. off the
   * agent's `end-of-session` SQS message, while the learner-facing summary
   * fires from the separate client/REST end path. So the two fail
   * independently: whenever the agent never joins, dies mid-session, or the
   * worker gives up reconnecting, the session gets a summary but is silently
   * never scored. This sweeps those up.
   *
   * Idempotent by construction — it only selects rows with no
   * `evaluationStatus`, and {@link triggerForSession} re-checks the same guard
   * before spending anything. Never throws: it runs from the shared scheduler.
   */
  async runCatchup(): Promise<{ found: number; triggered: number }> {
    const now = new Date();
    const endedBefore = new Date(
      now.getTime() - CATCHUP_GRACE_MINUTES * 60 * 1000,
    );
    const endedAfter = new Date(
      now.getTime() - CATCHUP_WINDOW_HOURS * 60 * 60 * 1000,
    );

    let sessions: ScenarioSessions[];
    try {
      sessions =
        await this.scenarioSessionRepository.findSessionsMissingActorEvaluation(
          { endedAfter, endedBefore, limit: CATCHUP_BATCH_LIMIT },
        );
    } catch (error) {
      this.logger.error(
        `[ACTOR_EVAL_CATCHUP] scan failed: ${(error as Error)?.message}`,
      );
      return { found: 0, triggered: 0 };
    }

    if (!sessions.length) {
      this.logger.debug('[ACTOR_EVAL_CATCHUP] nothing to catch up.');
      return { found: 0, triggered: 0 };
    }

    // Sequential: each trigger is an outbound ai-learn call, and this is a
    // background sweep with no deadline. Never race the live session-end path
    // for ai-learn capacity.
    let triggered = 0;
    for (const session of sessions) {
      // triggerForSession swallows its own errors and re-checks the guard, so
      // one bad session can't abort the sweep. Count what it actually
      // dispatched, not rows visited — a session evaluated between the scan and
      // the trigger reports false.
      if (await this.triggerForSession(session)) triggered += 1;
    }

    // Log rather than silently truncate: a full batch means a backlog remains
    // and the next tick will take the rest.
    const truncated = sessions.length === CATCHUP_BATCH_LIMIT;
    this.logger.info(
      `[ACTOR_EVAL_CATCHUP] ${triggered}/${sessions.length} session(s) missed ` +
        `by the end-of-session trigger dispatched to the judge` +
        (truncated
          ? ` (batch limit ${CATCHUP_BATCH_LIMIT} reached — more remain)`
          : ''),
    );

    return { found: sessions.length, triggered };
  }

  /**
   * Evaluate a just-finished V2V run immediately, instead of leaving it to the
   * 30-minute catch-up sweep.
   *
   * WHY THIS EXISTS. The normal fast path is `triggerForSession` inside
   * `handleEndScenarioSessionEvent`, but that method returns early when the
   * session is already ENDED — and for a V2V run it always is: the tester
   * disconnects cleanly, so `RoomFinishedHandler` ends the session a beat
   * before the agent's `end-of-session` SQS event arrives (measured 0.5s apart
   * in prod). The evaluation trigger is collateral of a guard that exists to
   * stop credits being double-charged, so every V2V run silently fell through
   * to the catch-up and waited `CATCHUP_GRACE_MINUTES` plus up to a full tick.
   * That is fine for a background sweep and useless for a test harness, where
   * the score IS the result being waited on.
   *
   * Deliberately fire-and-forget, and deliberately still covered by the
   * catch-up: the settle wait lives in this process, so a deploy or crash
   * during it loses the fast path, not the evaluation. `triggerForSession`
   * re-checks IN_PROGRESS/COMPLETED, so the sweep finding the same session
   * later costs nothing and cannot double-spend a judge run.
   *
   * Never throws — the caller is a webhook whose job is ending the session.
   */
  scheduleV2VEvaluation(scenarioSessionId: string): void {
    setTimeout(() => {
      void (async () => {
        try {
          const session = await this.scenarioSessionRepository.findOne({
            where: { id: scenarioSessionId },
          });
          if (!session) {
            this.logger.warn(
              `[ACTOR_EVAL_V2V] session ${scenarioSessionId} not found; ` +
                'leaving it to the catch-up sweep.',
            );
            return;
          }
          const dispatched = await this.triggerForSession(session);
          this.logger.info(
            `[ACTOR_EVAL_V2V] session ${scenarioSessionId}: ` +
              (dispatched
                ? 'judge dispatched without waiting for the catch-up.'
                : 'not dispatched (see the reason logged above).'),
          );
        } catch (error) {
          // The catch-up remains the backstop, so this is a degraded fast
          // path rather than a lost evaluation.
          this.logger.error(
            `[ACTOR_EVAL_V2V] fast-path evaluation failed for ` +
              `${scenarioSessionId}: ${(error as Error)?.message}`,
          );
        }
      })();
    }, V2V_EVALUATION_SETTLE_MS).unref?.();
  }

  /**
   * Kick off the actor evaluation for a just-ended session. No-op (logged) when
   * there are no configured goals, no transcript, or the session has already
   * been evaluated. Never throws.
   *
   * Returns whether a judge run was actually dispatched, so the catch-up can
   * report real spend rather than rows visited.
   */
  async triggerForSession(scenarioSession: ScenarioSessions): Promise<boolean> {
    try {
      const sessionId = scenarioSession.id;

      // Idempotency: `end-of-session` arrives over SQS and can be redelivered,
      // which would re-run a full-transcript LLM judge on a session we have
      // already scored. Mirrors the drift judge's `onlyUnjudged` guard.
      // FAILED is deliberately NOT skipped — a failed evaluation stays
      // retriggerable so a superadmin/backfill can retry it.
      const existing = await this.scenarioSessionDetailsRepository.findOne({
        where: { scenarioSessionId: sessionId },
        select: { id: true, evaluationStatus: true },
      });
      if (
        existing?.evaluationStatus === ActorEvaluationStatus.IN_PROGRESS ||
        existing?.evaluationStatus === ActorEvaluationStatus.COMPLETED
      ) {
        this.logger.info(
          `Skipping actor evaluation for ${sessionId}: already ` +
            `${existing.evaluationStatus}.`,
        );
        return false;
      }

      const { data: goals } =
        await this.agentTestCaseService.getAgentTestCases();
      if (!goals.length) {
        this.logger.info(
          `Skipping actor evaluation for ${sessionId}: no agent test cases configured.`,
        );
        return false;
      }

      const messages = await this.scenarioSessionMessagesRepository.find({
        where: {
          scenarioSessionId: sessionId,
          tenantId: scenarioSession.tenantId,
        },
        order: { startSeconds: 'ASC', createdAt: 'ASC' },
      });
      if (!messages.length) {
        this.logger.info(
          `Skipping actor evaluation for ${sessionId}: no transcript.`,
        );
        return false;
      }

      const transcript: ActorGoalEvaluationTurn[] = messages.map((m) => ({
        // The trainee/counselor speaks as the user; everything else is the
        // roleplay actor we are scoring.
        role: m.senderId === scenarioSession.counselorId ? 'user' : 'assistant',
        content: m.content,
      }));

      // Mark IN_PROGRESS up-front so the UI can show "evaluating…" and a late
      // webhook can be correlated.
      await this.upsertDetails(scenarioSession, {
        evaluationStatus: ActorEvaluationStatus.IN_PROGRESS,
      });

      await this.aiService.triggerActorGoalEvaluation({
        scenario_session_id: sessionId,
        transcript,
        goals: goals.map((g) => ({
          id: g.id,
          title: g.title,
          // The ai-learn judge contract still carries a single `category`
          // string; join the tag list so migrated rows keep the same value.
          category: (g.tags ?? []).join(', '),
          description: g.description ?? null,
        })),
        language: this.resolveLanguage(scenarioSession),
      });

      this.logger.info(
        `Triggered actor evaluation for ${sessionId} against ${goals.length} goal(s).`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to trigger actor evaluation for ${scenarioSession?.id}: ${
          (error as Error)?.message
        }`,
      );
      return false;
    }
  }

  /**
   * Persist an evaluation result from the ai-learn webhook. Computes the
   * composite as round(mean(APPLICABLE metrics)) so a real session is scored on
   * the same 0-100 scale as Copilot/practice runs.
   */
  async applyResult(
    scenarioSessionId: string,
    payload: UpdateActorEvaluationDto,
  ): Promise<void> {
    const metrics = payload.metrics ?? null;
    const notApplicable = payload.not_applicable ?? [];
    const composite = this.computeComposite(metrics, notApplicable);

    const updated = await this.scenarioSessionDetailsRepository.update(
      { scenarioSessionId },
      {
        metrics: metrics ?? undefined,
        // Persist [] as well as a populated list: "the judge considered
        // applicability and found none inapplicable" is a different fact from
        // "this row predates applicability", which is null.
        notApplicableGoals: payload.not_applicable ?? undefined,
        compositeScore: composite ?? undefined,
        evaluationMarkdown: payload.report_markdown ?? undefined,
        evaluationStatus: payload.status,
        evaluatedAt: new Date(),
      },
    );

    // The details row should already exist (created during the session / at
    // trigger time). If it somehow doesn't, there's nothing to attach to —
    // log rather than silently no-op.
    if (!updated.affected) {
      this.logger.warn(
        `Actor evaluation webhook for ${scenarioSessionId} matched no ` +
          `scenario_session_details row; result was dropped.`,
      );
    } else {
      this.logger.info(
        `Stored actor evaluation for ${scenarioSessionId} ` +
          `(status=${payload.status}, composite=${composite ?? 'n/a'}).`,
      );
    }
  }

  /**
   * round(mean of finite numeric scores for APPLICABLE goals), or null when
   * none.
   *
   * Goals the conversation gave no occasion to demonstrate are excluded: the
   * agent test cases are global, so scoring a session against a goal it never
   * had a chance to exercise used to pull the mean down by however many
   * irrelevant goals happened to be configured.
   *
   * If the judge marked EVERY goal inapplicable, the result is null rather
   * than a score — "we could not judge this session" is the honest answer, and
   * a null keeps it out of the analytics rather than seeding a fake number.
   */
  private computeComposite(
    metrics: Record<string, number> | null,
    notApplicable: string[] = [],
  ): number | null {
    if (!metrics) return null;
    const excluded = new Set(notApplicable);
    const values = Object.entries(metrics)
      .filter(([title]) => !excluded.has(title))
      .map(([, v]) => v)
      .filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /** Create-or-update the details row, carrying tenantId on insert. */
  private async upsertDetails(
    scenarioSession: ScenarioSessions,
    patch: Partial<{
      evaluationStatus: string;
      metrics: Record<string, number>;
      compositeScore: number;
      evaluationMarkdown: string;
      evaluatedAt: Date;
    }>,
  ): Promise<void> {
    // Atomic upsert against the unique scenarioSessionId index (migration
    // 1869): the previous find-then-create raced the summary writer at
    // session end and produced duplicate details rows. Only the patch
    // columns are written on conflict, so an existing summary is untouched.
    await this.scenarioSessionDetailsRepository.upsert(
      {
        scenarioSessionId: scenarioSession.id,
        tenantId: scenarioSession.tenantId,
        ...patch,
      },
      { conflictPaths: ['scenarioSessionId'] },
    );
  }

  private resolveLanguage(
    scenarioSession: ScenarioSessions,
  ): string | undefined {
    const languageId = scenarioSession.metadata?.languageId;
    return languageId !== undefined && languageId !== null
      ? String(languageId)
      : undefined;
  }
}
