import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AiService } from 'src/ai/service/ai.service';
import { ActorGoalEvaluationTurn } from 'src/ai/dto/ai.request.dto';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { AgentTestCaseService } from './agent-test-case.service';
import { UpdateActorEvaluationDto } from '../dto/scenario-session-evaluation.dto';

/** Lifecycle states stored in scenario_session_details.evaluationStatus. */
export enum ActorEvaluationStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

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
  ) {}

  /**
   * Kick off the actor evaluation for a just-ended session. No-op (logged) when
   * there are no configured goals or no transcript. Never throws.
   */
  async triggerForSession(scenarioSession: ScenarioSessions): Promise<void> {
    try {
      const sessionId = scenarioSession.id;

      const { data: goals } =
        await this.agentTestCaseService.getAgentTestCases();
      if (!goals.length) {
        this.logger.info(
          `Skipping actor evaluation for ${sessionId}: no agent test cases configured.`,
        );
        return;
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
        return;
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
    } catch (error) {
      this.logger.error(
        `Failed to trigger actor evaluation for ${scenarioSession?.id}: ${
          (error as Error)?.message
        }`,
      );
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
    const existing = await this.scenarioSessionDetailsRepository.findOne({
      where: { scenarioSessionId: scenarioSession.id },
    });
    if (existing) {
      Object.assign(existing, patch);
      await this.scenarioSessionDetailsRepository.save(existing);
      return;
    }
    await this.scenarioSessionDetailsRepository.save(
      this.scenarioSessionDetailsRepository.create({
        scenarioSessionId: scenarioSession.id,
        tenantId: scenarioSession.tenantId,
        ...patch,
      }),
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
