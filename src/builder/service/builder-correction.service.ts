import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { parseFirstJsonObject } from 'src/learn/util/autofill-shared.util';
import {
  BUILDER_CORRECTION_CATEGORIES,
  BuilderCorrection,
  BuilderCorrectionCategory,
  BuilderCorrectionRoutes,
} from '../entity/builder-correction.entity';
import { BuilderMessage } from '../entity/builder-message.entity';
import {
  BuilderLessonCategory,
  BuilderMessageRole,
} from '../enum/builder.enum';
import { BUILDER_AI_TASKS } from '../constants/builder.constants';
import { isAcknowledgement } from '../util/builder-readiness-checks.util';
import { freeTextOf } from './builder-readiness.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderEvalFixtureService } from '../eval/service/builder-eval-fixture.service';
import { BuilderEvalInterviewPayload } from '../eval/type/builder-eval.type';

/** How far back the daily scan looks. Overlaps on purpose; the unique message id dedupes. */
export const BUILDER_CORRECTION_SCAN_DAYS = 3;
/** Messages classified per scan, so one scan cannot run up an unbounded bill. */
const SCAN_LIMIT = 200;
/** Shorter than this, a message says too little to be a correction worth routing. */
const MIN_CHARS = 12;
const TEXT_MAX = 2000;
const CLASSIFY_MAX_TOKENS = 3000;
/** Prefix that marks a fixture the loop made, as opposed to one a person curated. */
export const AUTO_FIXTURE_PREFIX = 'auto: ';

export const BUILDER_CORRECTION_SYSTEM_PROMPT = `You read one exchange from an interview between Builder — an agent that interviews an admin into a product requirements document for the Ally platform — and the admin. Decide whether the admin's reply CORRECTS Builder: tells it that something it said, assumed, proposed or asked was wrong, already exists, left something out, or was unnecessary.

Answering Builder's question, adding a new requirement, choosing between options, or saying "ok" is NOT a correction. Correcting Builder's facts, its plan, its scope, or its decision to ask at all IS.

When it is a correction, classify it as exactly one of:
- missing_capability: Builder did not know the platform already has something ("this already exists", "use X instead", "promotion is already built").
- stale_doc: Builder relied on documentation or knowledge that is wrong or out of date.
- platform_scope: a platform, app or repo was left out or wrongly included (e.g. mobile missed, the change is in the backend not the web app).
- over_asking: Builder asked something it could have found itself, or kept asking when it had enough ("you have everything, write it").
- other: a correction that fits none of these.

Write everything in general terms about the platform. Never name or describe the admin.

Return one JSON object and nothing else:
{"isCorrection":true,"category":"missing_capability","subject":"what it was about, a few words","detail":"what Builder got wrong, one sentence","lesson":"one sentence a future interview should know, or null","capability":{"name":"…","whatItIs":"…","reuseWhen":"…"} or null (missing_capability only, when the admin named a system),"doc":{"path":"repo:path if known, else null","fix":"what the doc should say"} or null (stale_doc only),"checklistItem":{"text":"the thing itself, e.g. 'Reuses Auto-improve for challengers' or 'A new challenger job'","kind":"must or must_not"} or null}

When it is not a correction: {"isCorrection":false}`;

export interface CorrectionClassification {
  isCorrection: boolean;
  category?: BuilderCorrectionCategory;
  subject?: string;
  detail?: string;
  lesson?: string | null;
  capability?: BuilderCorrectionRoutes['capability'];
  doc?: BuilderCorrectionRoutes['doc'];
  checklistItem?: BuilderCorrectionRoutes['checklistItem'];
}

const clip = (value: unknown, max: number): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

/**
 * A checklist line as the judge needs it: the thing itself, and whether the
 * PRD must or must not contain it. The classifier sometimes writes the
 * negation into the text and still tags the line `must` ("The PRD must not
 * redefine promotion…", kind must) — which the judge would then score as
 * something the PRD has to say. A line that opens with "must not" is a
 * must_not line, whatever the tag.
 */
export function checklistLine(
  rawText: string,
  rawKind: unknown,
): { text: string; kind: 'must' | 'must_not' } {
  const text = clip(rawText, 600);
  const negated = text.match(
    /^(?:the\s+prd\s+)?(?:must|should)\s+not\s+(.+)$/i,
  );
  if (negated) {
    const rest = negated[1].trim();
    return {
      text: rest.charAt(0).toUpperCase() + rest.slice(1),
      kind: 'must_not',
    };
  }
  return { text, kind: rawKind === 'must_not' ? 'must_not' : 'must' };
}

export function parseCorrection(text: string): CorrectionClassification | null {
  const parsed = parseFirstJsonObject(
    String(text ?? '')
      .replace(/^```[\w-]*\s*/i, '')
      .replace(/\s*```\s*$/, ''),
  );
  if (!parsed || typeof parsed.isCorrection !== 'boolean') return null;
  if (!parsed.isCorrection) return { isCorrection: false };
  const category = BUILDER_CORRECTION_CATEGORIES.includes(parsed.category)
    ? (parsed.category as BuilderCorrectionCategory)
    : 'other';
  const capability =
    category === 'missing_capability' && parsed.capability?.name
      ? {
          name: clip(parsed.capability.name, 120),
          whatItIs: clip(parsed.capability.whatItIs, 400),
          reuseWhen: clip(parsed.capability.reuseWhen, 400),
        }
      : null;
  const doc =
    category === 'stale_doc' && parsed.doc?.fix
      ? {
          path: parsed.doc.path ? clip(parsed.doc.path, 300) : null,
          fix: clip(parsed.doc.fix, 800),
        }
      : null;
  const checklistItem = parsed.checklistItem?.text
    ? checklistLine(
        String(parsed.checklistItem.text),
        parsed.checklistItem.kind,
      )
    : null;
  return {
    isCorrection: true,
    category,
    subject: clip(parsed.subject, 200) || undefined,
    detail: clip(parsed.detail, 600) || undefined,
    lesson: parsed.lesson ? clip(parsed.lesson, 500) : null,
    capability,
    doc,
    checklistItem,
  };
}

/**
 * Builder's learning loop: every correction an admin makes becomes something
 * the system keeps.
 *
 * Today a correction is typed once, fixes one PRD, and is forgotten — the
 * next interview on a neighbouring feature makes the same mistake (five of
 * eight production corrections were "this already exists"). Each one is now
 * classified and sent four ways:
 *
 * - a **lesson candidate**, which the existing curator folds into the lessons
 *   every interview reads;
 * - a **capability line** draft, for a person to add to the reusable-systems
 *   map (it is code, so it goes through a PR);
 * - a **doc fix** draft, for a person — never automatic, because the wiki and
 *   the repos are public and this text came from production;
 * - an **eval case**: a checklist line on an inactive fixture cut from the
 *   session, so the correction becomes a replay the interviewer is held to
 *   once someone has read the line and switched the fixture on.
 *
 * Runs daily over the last few days of admin messages, and on demand.
 */
@Injectable()
export class BuilderCorrectionService {
  private readonly logger = LoggerService.getInstance(
    BuilderCorrectionService.name,
  );
  private readonly corrections: Repository<BuilderCorrection>;
  private scanning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly llmCompletion: LlmCompletionService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly fixtureService: BuilderEvalFixtureService,
  ) {
    this.corrections = dataSource.getRepository(BuilderCorrection);
  }

  /**
   * Classify admin messages not yet classified. Returns what it did. One scan
   * at a time per process; the scheduler's advisory lock covers the rest.
   */
  async scan(
    options: { since?: Date; sessionId?: string; limit?: number } = {},
  ): Promise<{ classified: number; corrections: number; skipped: number }> {
    if (this.scanning) return { classified: 0, corrections: 0, skipped: 0 };
    this.scanning = true;
    try {
      const since =
        options.since ??
        new Date(
          Date.now() - BUILDER_CORRECTION_SCAN_DAYS * 24 * 60 * 60 * 1000,
        );
      const candidates = await this.candidates(
        since,
        options.sessionId,
        Math.min(SCAN_LIMIT, options.limit ?? SCAN_LIMIT),
      );
      let classified = 0;
      let corrections = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        const outcome = await this.classifyOne(candidate);
        if (outcome === 'correction') corrections += 1;
        if (outcome === 'skipped') skipped += 1;
        if (outcome !== 'failed') classified += 1;
      }
      if (candidates.length) {
        this.logger.info(
          `[BUILDER_CORRECTIONS] scanned ${candidates.length} message(s): ` +
            `${corrections} correction(s), ${skipped} skipped without a model call`,
        );
      }
      return { classified, corrections, skipped };
    } finally {
      this.scanning = false;
    }
  }

  /** Corrections in a window, with the plan's north-star numbers. */
  async list(options: {
    since?: Date;
    category?: BuilderCorrectionCategory;
    status?: BuilderCorrection['status'];
  }): Promise<{
    corrections: BuilderCorrection[];
    summary: {
      sessions: number;
      correctedSessions: number;
      corrections: number;
      perSession: number;
      byCategory: Record<string, number>;
    };
  }> {
    const since =
      options.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.corrections.find({
      where: { messageAt: MoreThanOrEqual(since) },
      order: { messageAt: 'DESC' },
    });
    const counted = rows.filter(
      (row) => row.isCorrection && row.status !== 'dismissed',
    );
    const corrections = counted.filter(
      (row) =>
        (!options.category || row.category === options.category) &&
        (!options.status || row.status === options.status),
    );
    const sessions = new Set(rows.map((row) => row.sessionId)).size;
    const correctedSessions = new Set(counted.map((row) => row.sessionId)).size;
    const byCategory: Record<string, number> = {};
    for (const row of counted) {
      const key = row.category ?? 'other';
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
    return {
      corrections,
      summary: {
        sessions,
        correctedSessions,
        corrections: counted.length,
        perSession: sessions
          ? Math.round((counted.length / sessions) * 100) / 100
          : 0,
        byCategory,
      },
    };
  }

  /** A person's verdict: `dismissed` marks a classifier false positive. */
  async review(
    id: string,
    status: 'reviewed' | 'dismissed',
    note: string | null,
    userId: number,
  ): Promise<BuilderCorrection> {
    const row = await this.corrections.findOne({ where: { id } });
    if (!row) throw new NotFoundException('No such correction.');
    row.status = status;
    row.reviewNote = note ? clip(note, 1000) : null;
    row.reviewedBy = userId;
    row.reviewedAt = new Date();
    return this.corrections.save(row);
  }

  /** Admin messages after the opening one, not yet classified, oldest first. */
  private async candidates(
    since: Date,
    sessionId: string | undefined,
    limit: number,
  ): Promise<(BuilderMessage & { sessionTitle: string | null })[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT m.id, m."sessionId", m.seq, m.content, m.metadata, m."createdAt",
              s.title AS "sessionTitle"
         FROM builder_messages m
         JOIN builder_sessions s ON s.id = m."sessionId"
        WHERE m.role = $1
          AND m.seq > 1
          AND m."createdAt" >= $2
          AND ($3::uuid IS NULL OR m."sessionId" = $3::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM builder_corrections c WHERE c."messageId" = m.id
          )
        ORDER BY m."createdAt" ASC
        LIMIT $4`,
      [BuilderMessageRole.USER, since, sessionId ?? null, limit],
    );
    return rows;
  }

  private async classifyOne(
    message: BuilderMessage & { sessionTitle: string | null },
  ): Promise<'correction' | 'none' | 'skipped' | 'failed'> {
    const text = freeTextOf(message);
    const base = {
      sessionId: message.sessionId,
      messageId: message.id,
      sessionTitle: message.sessionTitle
        ? clip(message.sessionTitle, 200)
        : null,
      messageAt: new Date(message.createdAt),
      adminText: clip(text ?? message.content, TEXT_MAX),
    };
    // A card pick or "ok, thanks" corrects nothing; recorded so the scan
    // does not look at it again, without spending a call on it.
    if (!text || text.length < MIN_CHARS || isAcknowledgement(text)) {
      await this.insert({
        ...base,
        isCorrection: false,
        detail: 'not free text',
      });
      return 'skipped';
    }

    const previous: { content: string | null; metadata: any }[] =
      await this.dataSource.query(
        `SELECT content, metadata FROM builder_messages
          WHERE "sessionId" = $1 AND seq < $2 AND role = $3
          ORDER BY seq DESC LIMIT 1`,
        [message.sessionId, message.seq, BuilderMessageRole.ASSISTANT],
      );
    const builderSaid = [
      previous[0]?.content ?? '',
      previous[0]?.metadata?.questions?.[0]?.prompt
        ? `Question asked: ${previous[0].metadata.questions[0].prompt}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    let classification: CorrectionClassification | null = null;
    let model: string | null = null;
    try {
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.CORRECTION_CLASSIFY,
        task: LlmTask.BUILDER_CORRECTION_CLASSIFY,
        system: BUILDER_CORRECTION_SYSTEM_PROMPT,
        prompt: [
          `<request>${clip(message.sessionTitle, 200)}</request>`,
          '<builder>',
          clip(builderSaid, 4000) || '(nothing)',
          '</builder>',
          '<admin>',
          clip(text, TEXT_MAX),
          '</admin>',
        ].join('\n'),
        maxTokens: CLASSIFY_MAX_TOKENS,
        jsonMode: true,
        usageMetadata: { builderSessionId: message.sessionId },
      });
      classification = parseCorrection(result.text);
      model = result.model;
    } catch (error) {
      this.logger.warn(
        `Correction classification failed for message ${message.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Unclassified messages are left for the next scan rather than recorded
    // as "not a correction" on the strength of a call that never answered.
    if (!classification) return 'failed';

    if (!classification.isCorrection) {
      await this.insert({
        ...base,
        builderText: clip(builderSaid, TEXT_MAX),
        isCorrection: false,
        model,
      });
      return 'none';
    }

    const routes = await this.route(message, classification);
    await this.insert({
      ...base,
      builderText: clip(builderSaid, TEXT_MAX),
      isCorrection: true,
      category: classification.category ?? 'other',
      subject: classification.subject ?? null,
      detail: classification.detail ?? null,
      routes,
      model,
    });
    return 'correction';
  }

  /** Send a correction where it teaches something. Each route fails on its own. */
  private async route(
    message: BuilderMessage & { sessionTitle: string | null },
    classification: CorrectionClassification,
  ): Promise<BuilderCorrectionRoutes> {
    const routes: BuilderCorrectionRoutes = {
      lesson: classification.lesson ?? null,
      capability: classification.capability ?? null,
      doc: classification.doc ?? null,
      checklistItem: classification.checklistItem ?? null,
    };

    if (classification.lesson) {
      try {
        await this.knowledgeService.recordLesson({
          sessionId: message.sessionId,
          category: BuilderLessonCategory.PROCESS,
          lesson: `Interview correction (${classification.category}): ${classification.lesson}`,
        });
        routes.lessonRecorded = true;
      } catch (error) {
        this.logger.warn(
          `Lesson from correction ${message.id} not recorded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (classification.checklistItem) {
      try {
        routes.fixtureId = await this.addToFixture(
          message,
          classification.checklistItem,
          classification,
        );
      } catch (error) {
        this.logger.warn(
          `Eval case from correction ${message.id} not added: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return routes;
  }

  /**
   * Put the correction's checklist line on the session's fixture. A fixture
   * the loop made earlier gets the line appended; one a person curated is left
   * alone (its checklist is theirs); a session with none gets an inactive one,
   * cut from the session, which a person switches on after reading it.
   */
  private async addToFixture(
    message: BuilderMessage & { sessionTitle: string | null },
    item: { text: string; kind: 'must' | 'must_not' },
    classification: CorrectionClassification,
  ): Promise<string | null> {
    const existing = (await this.fixtureService.list()).find(
      (fixture) =>
        fixture.sourceSessionId === message.sessionId &&
        fixture.kind === 'interview',
    );
    if (existing) {
      if (!existing.name.startsWith(AUTO_FIXTURE_PREFIX) || existing.active) {
        return existing.id;
      }
      const checklist =
        (existing.payload as BuilderEvalInterviewPayload).checklist ?? [];
      if (!checklist.some((line) => line.text === item.text)) {
        await this.fixtureService.update(existing.id, {
          checklist: [
            ...checklist,
            { ...item, id: `C${checklist.length + 1}` },
          ],
        });
      }
      return existing.id;
    }
    const created = await this.fixtureService.createFromSession(
      message.sessionId,
      {
        name: `${AUTO_FIXTURE_PREFIX}${clip(message.sessionTitle ?? 'Builder session', 80)} (${message.sessionId.slice(0, 8)})`,
        checklist: [item],
        notes:
          `Cut by the corrections loop: the admin corrected Builder (${classification.category}). ` +
          'Read the checklist, add what else a correct PRD contains, then switch the fixture on.',
        active: false,
      },
      0,
    );
    return created.id;
  }

  private async insert(row: Partial<BuilderCorrection>): Promise<void> {
    await this.corrections
      .createQueryBuilder()
      .insert()
      .into(BuilderCorrection)
      .values(row as BuilderCorrection)
      .orIgnore()
      .execute();
  }
}
