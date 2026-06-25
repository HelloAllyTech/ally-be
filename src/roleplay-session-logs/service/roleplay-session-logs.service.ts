import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ListRoleplaySessionLogsQueryDto,
  ListRoleplaySessionLogsResponseDto,
  RoleplaySessionLogDetailDto,
  RoleplaySessionLogRowDto,
} from '../dto/roleplay-session-logs.dto';
import { ScenarioSessionStatus } from '../../learn/enum/scenario-session-status.enum';
import {
  RoleplaySessionLogRawRow,
  RoleplaySessionLogsRepository,
} from '../repository/roleplay-session-logs.repository';

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
    return { data: rows.map((r) => this.toRow(r)), total };
  }

  /** Full detail (core + summary + events + transcript) for one session. */
  async getById(id: string): Promise<RoleplaySessionLogDetailDto> {
    const row = await this.roleplaySessionLogsRepository.findOne(id);
    if (!row) {
      throw new NotFoundException(`Roleplay session ${id} not found`);
    }

    const [summary, events, transcript] = await Promise.all([
      this.roleplaySessionLogsRepository.findSummary(id),
      this.roleplaySessionLogsRepository.findEvents(id),
      this.roleplaySessionLogsRepository.findTranscript(id),
    ]);

    return {
      ...this.toRow(row),
      summary: summary ?? null,
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
  private toRow(r: RoleplaySessionLogRawRow): RoleplaySessionLogRowDto {
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
      score: this.toNumberOrNull(r.score),
      platform: r.platform ?? null,
      createdAt: r.createdAt,
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
}
