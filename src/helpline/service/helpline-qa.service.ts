import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
  FhsSkill,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { FoundationalSkillsJudgeService } from 'src/foundational-skills/service/foundational-skills-judge.service';
import {
  NumberedLine,
  SkillVerdict,
} from 'src/foundational-skills/util/skill-scoring.util';
import {
  SessionTranscript,
  charLength,
  renderSession,
} from 'src/foundational-skills/util/transcript-window.util';
import { LoggerService } from 'src/logger/logger.service';
import {
  HelplineMessageType,
  HelplineQaStatus,
  HelplineSenderRole,
} from '../constants/helpline.constants';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineQaScore } from '../entity/helpline-qa-score.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  HelplineStaffUser,
  HelplineTenant,
  QaDetailDto,
  QaListItemDto,
  QaSkillDto,
} from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import { chatNotFound } from '../util/helpline-errors';
import { HelplineProfileService } from './helpline-profile.service';

/**
 * The ruler QA scores carry: the helping-skills rubric version plus the
 * helpline framing of the judge prompt. Scores of two versions are never
 * compared (docs/foundational-helping-skills.md §8, "Changing the ruler").
 */
export const HELPLINE_QA_RUBRIC_VERSION = `${FHS_RUBRIC_VERSION}+helpline-chat-v1`;

export const HELPLINE_QA = {
  /** Chats a tick takes on (one judge call each). */
  BATCH_SIZE: 10,
  /** Late writes (closing notice, summary) settle first. */
  SETTLE_MS: 5 * 60 * 1000,
  MIN_LISTENER_MESSAGES: 3,
  MIN_LISTENER_CHARS: 300,
  /**
   * A failed judgement (transport, or a reply that omits a skill) is retried
   * on later ticks up to this many attempts, then left FAILED — the same
   * bound the foundational-skills pipeline uses.
   */
  MAX_ATTEMPTS: 3,
  /** Evidence when the judge's quote cannot be located in its line. */
  FALLBACK_QUOTE_CHARS: 200,
  LIST_PAGE_SIZE: 25,
  MINE_LIMIT: 100,
} as const;

const TIER_LABEL: Record<FhsSkill['tier'], QaSkillDto['tier']> = {
  engage: 'Engage',
  understand: 'Understand',
  support: 'Support',
};

export interface QaTranscript {
  session: SessionTranscript;
  listenerMessages: number;
  listenerChars: number;
}

/**
 * The judge's view of a chat: the listener of record's TEXT as HELPER, the
 * talker's TEXT as CLIENT, in order. Anyone else's lines (a previous listener
 * before a transfer, a whisper, the copilot) are not the listener's and are
 * left out. Bodies arrive decrypted from the repository.
 */
export function buildQaTranscript(
  chat: {
    id: string;
    tenantId: string;
    listenerId: number | null;
    endedAt: Date | null;
  },
  turns: Pick<
    HelplineMessage,
    'id' | 'type' | 'senderRole' | 'senderUserId' | 'content' | 'erasedAt'
  >[],
): QaTranscript {
  const kept = turns.filter(
    (m) =>
      m.type === HelplineMessageType.TEXT &&
      m.erasedAt == null &&
      m.content.trim().length > 0 &&
      (m.senderRole === HelplineSenderRole.TALKER ||
        (chat.listenerId != null && m.senderUserId === chat.listenerId)),
  );
  const helper = kept.filter((m) => m.senderRole !== HelplineSenderRole.TALKER);
  return {
    session: {
      sessionId: chat.id,
      endedAt: chat.endedAt ?? new Date(),
      tenantId: chat.tenantId,
      turns: kept.map((m) => ({
        messageId: m.id,
        speaker:
          m.senderRole === HelplineSenderRole.TALKER ? 'client' : 'helper',
        text: m.content,
      })),
    },
    listenerMessages: helper.length,
    listenerChars: helper.reduce((sum, m) => sum + charLength(m.content), 0),
  };
}

/** Contract §10: ≥ 3 listener messages and ≥ 300 listener characters. */
export function qaEligible(
  t: Pick<QaTranscript, 'listenerMessages' | 'listenerChars'>,
): boolean {
  return (
    t.listenerMessages >= HELPLINE_QA.MIN_LISTENER_MESSAGES &&
    t.listenerChars >= HELPLINE_QA.MIN_LISTENER_CHARS
  );
}

/**
 * Where a judge's quote sits in its message, so evidence is stored as
 * offsets (never text — the body ages out, the quote with it).
 */
export function quoteOffsets(
  text: string,
  quote: string,
): { start: number; end: number } {
  const needle = quote.trim();
  let start = needle ? text.indexOf(needle) : -1;
  if (start < 0 && needle)
    start = text.toLowerCase().indexOf(needle.toLowerCase());
  if (start < 0) {
    return {
      start: 0,
      end: Math.min(text.length, HELPLINE_QA.FALLBACK_QUOTE_CHARS),
    };
  }
  return { start, end: start + needle.length };
}

interface StoredEvidence {
  code: string;
  messageId: number;
  start: number;
  end: number;
}

interface StoredSkill {
  skill: string;
  opportunity: boolean;
  level: number | null;
  observed: string[];
  notApplicable: string[];
  evidence: StoredEvidence[];
}

/**
 * Verdicts → what `helpline_qa_scores.verdicts` stores: codes, derived levels
 * and evidence as (message id, offsets). `lines[i]` is `session.turns[i]` —
 * `renderSession` numbers one whole session in order with no context block.
 */
export function storedVerdicts(
  verdicts: SkillVerdict[],
  lines: readonly NumberedLine[],
  session: SessionTranscript,
): StoredSkill[] {
  const turnByLine = new Map(
    lines.map((line, i) => [line.id, session.turns[i]]),
  );
  return verdicts.map((v) => ({
    skill: v.skill,
    opportunity: v.opportunity,
    level: v.level,
    observed: v.observed,
    notApplicable: v.notApplicable,
    evidence: (v.evidence ?? [])
      .map((e) => {
        const turn = turnByLine.get(e.line);
        if (!turn) return null;
        return {
          code: e.code,
          messageId: turn.messageId,
          ...quoteOffsets(turn.text, e.quote),
        };
      })
      .filter((e): e is StoredEvidence => e != null),
  }));
}

/** One stored skill → the listener-facing breakdown (contract §5.5). */
export function qaSkillDto(
  stored: StoredSkill,
  bodies: Map<number, Pick<HelplineMessage, 'content' | 'erasedAt'>>,
): QaSkillDto | null {
  const skill = FHS_RUBRIC.find((s) => s.key === stored.skill);
  if (!skill || stored.level == null) return null;
  const observed = new Set(stored.observed);
  const waived = new Set(stored.notApplicable);
  const texts = (list: { code: string; text: string }[]) =>
    list.filter((b) => observed.has(b.code)).map((b) => b.text);
  return {
    key: skill.key,
    label: skill.name,
    tier: TIER_LABEL[skill.tier],
    level: stored.level as QaSkillDto['level'],
    unhelpful: texts(skill.unhelpful),
    basicMet: texts(skill.basic),
    basicMissing: skill.basic
      .filter((b) => !observed.has(b.code) && !waived.has(b.code))
      .map((b) => b.text),
    advanced: texts(skill.advanced),
    evidence: stored.evidence
      .filter((e) => FHS_BEHAVIOURS_BY_CODE.get(e.code)?.skill === skill.key)
      .map((e) => {
        const body = bodies.get(e.messageId);
        return {
          messageId: e.messageId,
          quote:
            body && body.erasedAt == null
              ? body.content.slice(e.start, e.end)
              : '',
        };
      }),
  };
}

/**
 * Helping-skills QA of ended chats (contract §10): every 30 minutes, at most
 * 10 chats a tick, each judged once on the same rubric, pinned model and
 * validation as the foundational-skills measure. The model only ticks
 * behaviours with evidence; levels come from `deriveLevel` (the §3.1 rule),
 * never from the model. Shown to the listener (their own) and supervisors —
 * no leaderboard, no ranking, ordered by date only.
 *
 * Off with HELPLINE_QA_SCHEDULE=off (read on every tick).
 */
@Injectable()
export class HelplineQaService {
  private readonly logger = LoggerService.getInstance(HelplineQaService.name);

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    @InjectRepository(HelplineQaScore)
    private readonly scores: Repository<HelplineQaScore>,
    private readonly judge: FoundationalSkillsJudgeService,
    private readonly profiles: HelplineProfileService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = (env.HELPLINE_QA_SCHEDULE ?? 'on').trim().toLowerCase();
    return raw !== 'off' && raw !== 'false' && raw !== '0';
  }

  /** One scheduler tick. Never throws; one chat's failure is FAILED, not fatal. */
  async tick(now = new Date()): Promise<Record<string, number>> {
    const tally: Record<string, number> = {};
    if (!HelplineQaService.enabled()) return tally;
    const candidates = await this.chats.findQaCandidatesAcrossTenants(
      new Date(now.getTime() - HELPLINE_QA.SETTLE_MS),
      HELPLINE_QA.BATCH_SIZE,
    );
    for (const { id, tenantId } of candidates) {
      const status = await this.scoreChat(tenantId, id);
      if (status) tally[status] = (tally[status] ?? 0) + 1;
    }
    if (candidates.length) {
      this.logger.info(
        `Helpline QA tick: ${Object.entries(tally)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
    }
    return tally;
  }

  /** Score one ended chat; returns the status written (null if not taken). */
  async scoreChat(
    tenantId: string,
    chatId: string,
  ): Promise<HelplineQaStatus | null> {
    if (!(await this.chats.claimQa(tenantId, chatId))) return null;
    try {
      const chat = await this.chats.findById(tenantId, chatId);
      if (!chat || chat.listenerId == null || chat.erasedAt) {
        return this.finish(tenantId, chatId, HelplineQaStatus.SKIPPED);
      }
      const transcript = buildQaTranscript(
        chat,
        await this.messages.listTextTurns(tenantId, chatId),
      );
      if (!qaEligible(transcript)) {
        return this.finish(tenantId, chatId, HelplineQaStatus.SKIPPED);
      }
      const rendered = renderSession(transcript.session);
      if (!rendered) {
        return this.finish(tenantId, chatId, HelplineQaStatus.SKIPPED);
      }
      const outcome = await this.judge.judgeHelpline(
        rendered.text,
        rendered.lines,
        { chatId, rubricVersion: HELPLINE_QA_RUBRIC_VERSION },
      );
      if (outcome.compositeScore == null) {
        // Nothing the chat called for was assessable: no score is honest.
        return this.finish(tenantId, chatId, HelplineQaStatus.SKIPPED);
      }
      const skills = storedVerdicts(
        outcome.verdicts,
        rendered.lines,
        transcript.session,
      );
      await this.scores.save(
        this.scores.create({
          tenantId,
          chatId,
          listenerId: chat.listenerId,
          rubricVersion: HELPLINE_QA_RUBRIC_VERSION,
          levels: Object.fromEntries(
            skills
              .filter((s) => s.level != null)
              .map((s) => [s.skill, s.level as number]),
          ),
          verdicts: { skills, stats: outcome.stats },
          compositeScore: outcome.compositeScore,
          hasUnhelpfulBehaviour: outcome.hasUnhelpfulBehaviour === true,
          judgeModel: outcome.model,
        }),
      );
      return this.finish(tenantId, chatId, HelplineQaStatus.DONE);
    } catch (error) {
      this.logger.error(
        `Helpline QA failed for chat ${chatId}: ${(error as Error).message}`,
      );
      // Back to NULL for a later tick, until the attempt limit; then FAILED.
      const status = await this.chats
        .recordQaFailure(tenantId, chatId, HELPLINE_QA.MAX_ATTEMPTS)
        .catch(() => HelplineQaStatus.FAILED);
      return status ?? HelplineQaStatus.PENDING;
    }
  }

  private async finish(
    tenantId: string,
    chatId: string,
    status: HelplineQaStatus,
  ): Promise<HelplineQaStatus> {
    await this.chats
      .setQaStatus(tenantId, chatId, status)
      .catch((error) =>
        this.logger.error(
          `Could not record QA ${status} for chat ${chatId}: ${(error as Error).message}`,
        ),
      );
    return status;
  }

  // ── Read side ────────────────────────────────────────────────────────────

  /** Supervisors (`view:helpline:qa`): every listener, newest first, never ranked. */
  async list(
    tenant: HelplineTenant,
    query: { listenerId?: number; page?: number },
  ): Promise<{ items: QaListItemDto[]; total: number }> {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const listenerId =
      query.listenerId != null && Number.isInteger(Number(query.listenerId))
        ? Number(query.listenerId)
        : null;
    return this.page(
      tenant,
      listenerId,
      HELPLINE_QA.LIST_PAGE_SIZE,
      (page - 1) * HELPLINE_QA.LIST_PAGE_SIZE,
    );
  }

  /** A listener's own scores only. */
  async mine(
    tenant: HelplineTenant,
    user: HelplineStaffUser,
  ): Promise<{ items: QaListItemDto[] }> {
    const { items } = await this.page(
      tenant,
      user.id,
      HELPLINE_QA.MINE_LIMIT,
      0,
    );
    return { items };
  }

  /** Own chat, or `view:helpline:qa`; anyone else gets a 404. */
  async detail(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    permissions: readonly string[],
  ): Promise<QaDetailDto> {
    const score = await this.scores.findOne({
      where: { tenantId: tenant.id, chatId },
    });
    if (
      !score ||
      (score.listenerId !== user.id &&
        !permissions.includes(PERMISSIONS.VIEW_HELPLINE_QA))
    ) {
      throw chatNotFound();
    }
    const [item] = (await this.toItems(tenant, [score])) ?? [];
    const stored = ((score.verdicts?.skills as StoredSkill[]) ?? []).filter(
      (s) => s && s.level != null,
    );
    const ids = stored.flatMap((s) => s.evidence.map((e) => e.messageId));
    const bodies = new Map(
      (await this.messages.findByIds(tenant.id, ids)).map((m) => [m.id, m]),
    );
    const skills = FHS_RUBRIC.map((skill) =>
      stored.find((s) => s.skill === skill.key),
    )
      .filter((s): s is StoredSkill => s != null)
      .map((s) => qaSkillDto(s, bodies))
      .filter((s): s is QaSkillDto => s != null);
    // Evidence quotes are transcript excerpts.
    helplineAudit(
      'HELPLINE_TRANSCRIPT_ACCESSED',
      tenant.id,
      { chatId, view: 'qa' },
      user.id,
    );
    return { ...item, skills };
  }

  private async page(
    tenant: HelplineTenant,
    listenerId: number | null,
    limit: number,
    offset: number,
  ): Promise<{ items: QaListItemDto[]; total: number }> {
    const where =
      listenerId != null
        ? { tenantId: tenant.id, listenerId }
        : { tenantId: tenant.id };
    const [rows, total] = await this.scores.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: await this.toItems(tenant, rows), total };
  }

  private async toItems(
    tenant: HelplineTenant,
    rows: HelplineQaScore[],
  ): Promise<QaListItemDto[]> {
    const [names, chats] = await Promise.all([
      this.profiles.aliases(
        tenant.id,
        rows.map((r) => r.listenerId),
      ),
      Promise.all(rows.map((r) => this.chats.findById(tenant.id, r.chatId))),
    ]);
    return rows.map((row, i) => ({
      chatId: row.chatId,
      listenerId: row.listenerId,
      listenerName: names.get(row.listenerId) ?? '',
      endedAt: new Date(chats[i]?.endedAt ?? row.createdAt).toISOString(),
      compositeScore: Number(row.compositeScore),
      hasUnhelpfulBehaviour: row.hasUnhelpfulBehaviour,
      rubricVersion: row.rubricVersion,
    }));
  }
}
