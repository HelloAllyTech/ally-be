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
   * composite as round(mean(metrics)) so a real session is scored on the same
   * 0-100 scale as Copilot/practice runs.
   */
  async applyResult(
    scenarioSessionId: string,
    payload: UpdateActorEvaluationDto,
  ): Promise<void> {
    const metrics = payload.metrics ?? null;
    const composite = this.computeComposite(metrics);

    const updated = await this.scenarioSessionDetailsRepository.update(
      { scenarioSessionId },
      {
        metrics: metrics ?? undefined,
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

  /** round(mean of finite numeric metric values), or null when none. */
  private computeComposite(
    metrics: Record<string, number> | null,
  ): number | null {
    if (!metrics) return null;
    const values = Object.values(metrics).filter((v) => Number.isFinite(v));
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
