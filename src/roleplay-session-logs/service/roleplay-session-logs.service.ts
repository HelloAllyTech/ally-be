import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ListRoleplaySessionLogsQueryDto,
  ListRoleplaySessionLogsResponseDto,
  RoleplaySessionActorEvaluationDto,
  RoleplaySessionLatencyDto,
  RoleplaySessionLogDetailDto,
  RoleplaySessionLogRowDto,
  RoleplaySessionModelsDto,
  RoleplaySessionUsageDto,
} from '../dto/roleplay-session-logs.dto';
import { ScenarioSessionStatus } from '../../learn/enum/scenario-session-status.enum';
import {
  RoleplaySessionLatencyRow,
  RoleplaySessionLogRawRow,
  RoleplaySessionLogsRepository,
  RoleplaySessionUsageRow,
} from '../repository/roleplay-session-logs.repository';
import {
  AiServiceName,
  computeServiceCostUsd,
} from '../../analytics/constants/llm-pricing.constants';

/** Round a USD figure to cents, matching PlatformAnalyticsService. */
const roundUsd = (n: number): number => Math.round(n * 100) / 100;

/**
 * Composite an actor evaluation must reach to "pass". Mirrors the Copilot
 * auto-build success bar (COPILOT_SCORE_THRESHOLD) so a real session and a
 * synthetic practice run are judged on the same scale.
 */
const ACTOR_EVALUATION_PASS_THRESHOLD = 90;

/** Per-session usage rollup attached to a list row (tokens + cost). */
interface UsageSummary {
  totalTokens: number;
  estimatedCostUsd: number;
  priced: boolean;
}

@Injectable()
export class RoleplaySessionLogsService {
  constructor(
    private readonly roleplaySessionLogsRepository: RoleplaySessionLogsRepository,
  ) {}

  /** Cross-tenant, filtered, paginated list of genuine end-user roleplays. */
  async list(
    query: ListRoleplaySessionLogsQueryDto,
  ): Promise<ListRoleplaySessionLogsResponseDto> {
    const { rows, total } =
      await this.roleplaySessionLogsRepository.list(query);

    // One bounded query for the page's sessions, then price + roll up per
    // session in TS (the pricing tables live here, not in SQL).
    const usageRows =
      await this.roleplaySessionLogsRepository.getUsageBySessions(
        rows.map((r) => r.id),
      );
    const usageBySession = this.groupUsageBySession(usageRows);

    const data = rows.map((r) => {
      const usage = this.buildUsage(usageBySession.get(r.id) ?? []);
      const summary: UsageSummary | undefined = usage
        ? {
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
            priced: usage.priced,
          }
        : undefined;
      return this.toRow(r, summary);
    });

    return { data, total };
  }

  /** Full detail (core + summary + events + transcript + usage/models/latency). */
  async getById(id: string): Promise<RoleplaySessionLogDetailDto> {
    const row = await this.roleplaySessionLogsRepository.findOne(id);
    if (!row) {
      throw new NotFoundException(`Roleplay session ${id} not found`);
    }

    const [
      summary,
      events,
      transcript,
      usageRows,
      latencyRow,
      recording,
      feedback,
      agentTestCases,
    ] = await Promise.all([
      this.roleplaySessionLogsRepository.findSummary(id),
      this.roleplaySessionLogsRepository.findEvents(id),
      this.roleplaySessionLogsRepository.findTranscript(id),
      this.roleplaySessionLogsRepository.getUsageBySession(id),
      this.roleplaySessionLogsRepository.getLatencyBySession(id),
      this.roleplaySessionLogsRepository.getRecordingBySession(id),
      this.roleplaySessionLogsRepository.getFeedbackBySession(id),
      this.roleplaySessionLogsRepository.findAgentTestCases(),
    ]);

    const usage = this.buildUsage(usageRows);
    const usageSummary: UsageSummary | undefined = usage
      ? {
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          priced: usage.priced,
        }
      : undefined;

    return {
      ...this.toRow(row, usageSummary),
      scenarioVersionId: row.scenarioVersionId ?? null,
      language: row.language ?? null,
      voiceId: row.voiceId ?? null,
      totalPausedMs: this.toNumberOrNull(row.totalPausedMs),
      summary: summary ?? null,
      usage,
      models: this.buildModels(usageRows),
      latency: this.buildLatency(latencyRow),
      recording: recording ?? null,
      feedback: feedback
        ? {
            rating: Number(feedback.rating),
            feedback: feedback.feedback ?? null,
            tags: Array.isArray(feedback.tags) ? feedback.tags : [],
          }
        : null,
      actorEvaluation: this.buildActorEvaluation(row),
      agentTestCases: agentTestCases.map((g) => ({
        id: g.id,
        title: g.title,
        category: g.category,
        description: g.description ?? null,
      })),
      events: events.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        eventName: e.eventName ?? null,
        occurredAt: e.occurredAt,
        score: this.toNumberOrNull(e.score),
        emoji: e.emoji ?? null,
        message: e.message ?? null,
      })),
      transcript: transcript.map((m) => ({
        id: Number(m.id),
        senderId: Number(m.senderId),
        content: m.content,
        startSeconds: this.toNumberOrNull(m.startSeconds),
        endSeconds: this.toNumberOrNull(m.endSeconds),
        createdAt: m.createdAt,
      })),
    };
  }

  /** Maps a raw query row into the API row shape (numeric coercion + duration). */
  private toRow(
    r: RoleplaySessionLogRawRow,
    usage?: UsageSummary,
  ): RoleplaySessionLogRowDto {
    return {
      id: r.id,
      counselorId: Number(r.counselorId),
      counselorName: r.counselorName ?? null,
      counselorEmail: r.counselorEmail ?? null,
      tenantId: r.tenantId,
      orgName: r.orgName ?? null,
      scenarioId: Number(r.scenarioId),
      scenarioTitle: r.scenarioTitle ?? null,
      status: r.status as ScenarioSessionStatus,
      startedAt: r.startedAt ?? null,
      endedAt: r.endedAt ?? null,
      durationSeconds: this.resolveDurationSeconds(r),
      score: this.clampScore(this.toNumberOrNull(r.score)),
      platform: r.platform ?? null,
      createdAt: r.createdAt,
      totalTokens: usage ? usage.totalTokens : null,
      estimatedCostUsd: usage ? usage.estimatedCostUsd : null,
      costPriced: usage ? usage.priced : true,
      isV2VTest: r.isV2VTest === true,
    };
  }

  /** Buckets usage rows by their owning session id. */
  private groupUsageBySession(
    rows: RoleplaySessionUsageRow[],
  ): Map<string, RoleplaySessionUsageRow[]> {
    const map = new Map<string, RoleplaySessionUsageRow[]>();
    for (const row of rows) {
      const list = map.get(row.scenarioSessionId);
      if (list) list.push(row);
      else map.set(row.scenarioSessionId, [row]);
    }
    return map;
  }

  /**
   * Rolls per-(service, model) usage rows into the session usage DTO and prices
   * each via the shared pricing tables. Returns null when there is no usage.
   */
  private buildUsage(
    rows: RoleplaySessionUsageRow[],
  ): RoleplaySessionUsageDto | null {
    if (rows.length === 0) return null;

    let llmPromptTokens = 0;
    let llmCompletionTokens = 0;
    let llmTotalTokens = 0;
    let llmCachedTokens = 0;
    let sttAudioMs = 0;
    let ttsCharacters = 0;
    let estimatedCostUsd = 0;
    let priced = true;

    const byServiceModel = rows.map((r) => {
      const service = r.service as AiServiceName;
      const promptTokens = Number(r.promptTokens) || 0;
      const completionTokens = Number(r.completionTokens) || 0;
      const totalTokens = Number(r.totalTokens) || 0;
      const cachedTokens = Number(r.cachedTokens) || 0;
      const audioMs = Number(r.audioMs) || 0;
      const characters = Number(r.characters) || 0;
      const calls = Number(r.calls) || 0;

      const { costUsd, priced: rowPriced } = computeServiceCostUsd(
        service,
        r.provider,
        r.model,
        { promptTokens, completionTokens, audioMs, characters },
      );
      if (!rowPriced) priced = false;
      estimatedCostUsd += costUsd;

      if (service === 'llm') {
        llmPromptTokens += promptTokens;
        llmCompletionTokens += completionTokens;
        llmTotalTokens += totalTokens;
        llmCachedTokens += cachedTokens;
      } else if (service === 'stt') {
        sttAudioMs += audioMs;
      } else if (service === 'tts') {
        ttsCharacters += characters;
      }

      return {
        service: r.service,
        provider: r.provider,
        model: r.model,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        audioMs,
        characters,
        calls,
        estimatedCostUsd: roundUsd(costUsd),
        priced: rowPriced,
      };
    });

    return {
      llmPromptTokens,
      llmCompletionTokens,
      llmTotalTokens,
      llmCachedTokens,
      sttAudioMs,
      ttsCharacters,
      totalTokens: llmTotalTokens,
      estimatedCostUsd: roundUsd(estimatedCostUsd),
      priced,
      byServiceModel,
    };
  }

  /** Distinct (provider, model) per AI service from the usage rows. */
  private buildModels(
    rows: RoleplaySessionUsageRow[],
  ): RoleplaySessionModelsDto | null {
    if (rows.length === 0) return null;
    const distinct = (service: string) => {
      const seen = new Set<string>();
      const out: Array<{ provider: string; model: string }> = [];
      for (const r of rows) {
        if (r.service !== service) continue;
        const key = `${r.provider} ${r.model}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider: r.provider, model: r.model });
      }
      return out;
    };
    return {
      llm: distinct('llm'),
      stt: distinct('stt'),
      tts: distinct('tts'),
    };
  }

  /**
   * Builds the actor-evaluation block from the session-detail eval columns.
   * Returns null when the session was never evaluated (no status + no metrics).
   */
  private buildActorEvaluation(
    r: RoleplaySessionLogRawRow,
  ): RoleplaySessionActorEvaluationDto | null {
    const metrics =
      r.evalMetrics && typeof r.evalMetrics === 'object' ? r.evalMetrics : null;
    const compositeScore = this.toNumberOrNull(r.compositeScore);
    const status = r.evaluationStatus ?? null;

    // Nothing recorded at all -> session simply hasn't been evaluated.
    if (!status && compositeScore === null && !metrics) return null;

    return {
      compositeScore,
      metrics,
      markdown: r.evaluationMarkdown ?? null,
      status,
      evaluatedAt: r.evaluatedAt ?? null,
      passThreshold: ACTOR_EVALUATION_PASS_THRESHOLD,
      pass:
        compositeScore === null
          ? null
          : compositeScore >= ACTOR_EVALUATION_PASS_THRESHOLD,
    };
  }

  /** Maps the aggregate latency row to the DTO, or null when no pipeline turns. */
  private buildLatency(
    r: RoleplaySessionLatencyRow,
  ): RoleplaySessionLatencyDto | null {
    const turnCount = Number(r.turnCount) || 0;
    if (turnCount === 0) return null;
    return {
      turnCount,
      avgResponseLatencyMs: this.toNumberOrNull(r.avgResponseLatencyMs),
      p50ResponseLatencyMs: this.toNumberOrNull(r.p50ResponseLatencyMs),
      p95ResponseLatencyMs: this.toNumberOrNull(r.p95ResponseLatencyMs),
      avgEouDelayMs: this.toNumberOrNull(r.avgEouDelayMs),
      avgLlmTtftMs: this.toNumberOrNull(r.avgLlmTtftMs),
      avgTtsTtfbMs: this.toNumberOrNull(r.avgTtsTtfbMs),
      avgOrchestrationMs: this.toNumberOrNull(r.avgOrchestrationMs),
      avgLlmResponseMs: this.toNumberOrNull(r.avgLlmResponseMs),
      avgProsodyMs: this.toNumberOrNull(r.avgProsodyMs),
      avgBranchingMs: this.toNumberOrNull(r.avgBranchingMs),
      avgKnowledgeRetrievalMs: this.toNumberOrNull(r.avgKnowledgeRetrievalMs),
      avgProcessEventsMs: this.toNumberOrNull(r.avgProcessEventsMs),
      avgBehaviorsMs: this.toNumberOrNull(r.avgBehaviorsMs),
      interruptedTurns: Number(r.interruptedTurns) || 0,
      llmTimedOutTurns: Number(r.llmTimedOutTurns) || 0,
      prosodySkippedTurns: Number(r.prosodySkippedTurns) || 0,
    };
  }

  /**
   * Prefer the agent-reported `callDuration` (seconds). Otherwise derive it from
   * the session window minus paused time, but only when both endpoints exist.
   */
  private resolveDurationSeconds(r: RoleplaySessionLogRawRow): number | null {
    const callDuration = this.toNumberOrNull(r.callDuration);
    if (callDuration !== null && callDuration > 0) {
      return callDuration;
    }
    if (r.startedAt && r.endedAt) {
      const pausedMs = this.toNumberOrNull(r.totalPausedMs) ?? 0;
      const ms =
        new Date(r.endedAt).getTime() -
        new Date(r.startedAt).getTime() -
        pausedMs;
      return ms > 0 ? Math.round(ms / 1000) : 0;
    }
    return null;
  }

  private toNumberOrNull(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private clampScore(score: number | null): number | null {
    if (score === null) return null;
    return Math.min(100, Math.max(0, score));
  }
}
