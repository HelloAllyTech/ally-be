import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { parseFirstJsonObject } from 'src/learn/util/autofill-shared.util';
import { BuilderPrdDoc } from '../entity/builder-prd-doc.entity';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderMessageRole } from '../enum/builder.enum';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderPrdDocRepository } from '../repository/builder-prd.repository';
import {
  BUILDER_PRD_REVIEW_CATEGORIES,
  BuilderPrdDocument,
  BuilderPrdReview,
  BuilderPrdReviewCategory,
  BuilderPrdReviewDismissal,
  BuilderPrdReviewFinding,
} from '../type/builder-prd.type';
import {
  BUILDER_PRD_RECHECK_SYSTEM_PROMPT,
  BUILDER_PRD_REVIEW_MAX_FINDINGS,
  BUILDER_PRD_REVIEW_SECTION_KEYS,
  BUILDER_PRD_REVIEW_SYSTEM_PROMPT,
} from '../constants/builder-prd-review-prompt';
import { BUILDER_AI_TASKS } from '../constants/builder.constants';
import { BuilderEvidenceLogService } from './builder-evidence-log.service';
import { BuilderCatalogService } from './builder-catalog.service';

/** Output room for the reviewer. gpt-5-family caps count reasoning tokens too. */
const REVIEW_MAX_TOKENS = 16_000;

/** Transcript the full review reads, newest kept when it is longer. */
const TRANSCRIPT_BUDGET_CHARS = 60_000;
/** The recheck only needs the latest exchange, for unapplied corrections. */
const RECHECK_TRANSCRIPT_BUDGET_CHARS = 12_000;
const ADMIN_MESSAGE_MAX_CHARS = 3_000;
const BUILDER_MESSAGE_MAX_CHARS = 900;

/** Shortest dismissal reason accepted — "wrong" says nothing an eval can use. */
export const BUILDER_REVIEW_DISMISS_MIN_CHARS = 10;
const DISMISS_MAX_CHARS = 1_000;

const FIELD_MAX_CHARS = 600;

const clip = (value: unknown, max: number): string => {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** The PRD as the reviewer reads it: the stored keys minus the design and UI flags. */
function prdForReview(draft: BuilderPrdDocument): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { technicalDesign, ui, ...rest } = draft ?? ({} as BuilderPrdDocument);
  return JSON.stringify(rest, null, 1);
}

/**
 * The transcript as plain lines, newest kept within the budget, with the
 * opening admin message always kept — it is the request everything else
 * answers.
 */
export function renderTranscriptForReview(
  messages: BuilderMessage[],
  budget: number,
): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === BuilderMessageRole.USER) {
      const text = String(message.content ?? '').trim();
      if (text) lines.push(`ADMIN: ${clip(text, ADMIN_MESSAGE_MAX_CHARS)}`);
      continue;
    }
    const prose = String(message.content ?? '').trim();
    if (prose) lines.push(`BUILDER: ${clip(prose, BUILDER_MESSAGE_MAX_CHARS)}`);
    for (const result of message.toolResults ?? []) {
      if (result?.result?.ok === false) {
        lines.push(
          `[failed tool] ${result?.name ?? 'tool'}: ${clip(
            result?.result?.message ?? result?.result?.error ?? 'failed',
            240,
          )}`,
        );
      }
    }
  }
  if (!lines.length) return '';

  const first = lines[0].startsWith('ADMIN:') ? lines[0] : null;
  const kept: string[] = [];
  let used = first ? first.length : 0;
  for (let index = lines.length - 1; index >= (first ? 1 : 0); index--) {
    const line = lines[index];
    if (used + line.length + 1 > budget) break;
    kept.unshift(line);
    used += line.length + 1;
  }
  const dropped = lines.length - kept.length - (first ? 1 : 0);
  return [
    ...(first ? [first] : []),
    ...(dropped > 0 ? [`[… ${dropped} earlier line(s) left out …]`] : []),
    ...kept,
  ].join('\n');
}

/**
 * What Ally already runs, as plain facts for the reviewer: each system's name,
 * what it is for, and when to reuse it.
 *
 * Not the interviewer's rendering. That one carries instructions to the
 * interviewer ("run ai_tasks_lookup for anything involving an AI output"),
 * and the reviewer read those as requirements on the PRD — filing "missed
 * reuse: never consulted the AI task registry" against a sound PRD.
 */
export function renderSystemsForReview(catalog: BuilderCatalogService): string {
  try {
    return catalog
      .capabilities()
      .map(
        (capability) =>
          `- ${capability.name}: ${capability.whatItIs} Reuse when: ${capability.reuseWhen}`,
      )
      .join('\n');
  } catch {
    return '';
  }
}

/** The reviewer's findings, validated and numbered. Drops anything malformed. */
export function parseReviewFindings(
  text: string,
  versionNumber: number,
): BuilderPrdReviewFinding[] | null {
  const parsed = parseFirstJsonObject(
    String(text ?? '')
      .replace(/^```[\w-]*\s*/i, '')
      .replace(/\s*```\s*$/, ''),
  );
  if (!parsed || !Array.isArray(parsed.findings)) return null;

  const sections = new Set<string>(BUILDER_PRD_REVIEW_SECTION_KEYS);
  const categories = new Set<string>(BUILDER_PRD_REVIEW_CATEGORIES);
  const findings: BuilderPrdReviewFinding[] = [];
  for (const raw of parsed.findings) {
    const category = String(raw?.category ?? '').trim();
    const detail = clip(raw?.detail, FIELD_MAX_CHARS);
    if (!categories.has(category) || !detail) continue;
    const section = String(raw?.section ?? '').trim();
    const quote = clip(raw?.quote, 300);
    findings.push({
      id: `F${findings.length + 1}`,
      category: category as BuilderPrdReviewCategory,
      section: sections.has(section) ? section : 'summary',
      detail,
      fix: clip(raw?.fix, FIELD_MAX_CHARS) || 'Correct the PRD.',
      ...(quote ? { quote } : {}),
      status: 'open',
      raisedInVersion: versionNumber,
    });
    if (findings.length >= BUILDER_PRD_REVIEW_MAX_FINDINGS) break;
  }
  return findings;
}

/** The recheck's verdicts by finding id. Null when nothing usable came back. */
export function parseRecheck(
  text: string,
): Map<string, { resolved: boolean; note: string }> | null {
  const parsed = parseFirstJsonObject(
    String(text ?? '')
      .replace(/^```[\w-]*\s*/i, '')
      .replace(/\s*```\s*$/, ''),
  );
  if (!parsed || !Array.isArray(parsed.checks)) return null;
  const verdicts = new Map<string, { resolved: boolean; note: string }>();
  for (const raw of parsed.checks) {
    const id = String(raw?.id ?? '').trim();
    if (!id) continue;
    verdicts.set(id, {
      // Only an explicit true closes a finding — "probably" is not fixed.
      resolved: raw?.resolved === true,
      note: clip(raw?.note, 300),
    });
  }
  return verdicts;
}

/**
 * The cold PRD reviewer.
 *
 * The interviewer marks its own work ready, and in session 2bc3a5cf it did so
 * on a PRD that contradicted itself and had dropped the admin's last
 * correction. This is a second model with a fresh context — the same shape as
 * the technical design's critic — that reads the PRD against what the
 * interview actually found and heard.
 *
 * Two passes, one task:
 * - **review**, once, when every other readiness row first passes. Files
 *   findings.
 * - **recheck**, when the PRD has changed with findings open. Judges only the
 *   open findings against the current PRD; it can close one but never add one,
 *   so the loop converges instead of finding something new every time.
 *
 * Each finding blocks readiness until a recheck finds it fixed or a person
 * dismisses it with a reason. Dismissals are kept, with who and when — they are
 * the record of where the reviewer was wrong, which is what the eval needs.
 */
@Injectable()
export class BuilderPrdReviewService {
  private readonly logger = LoggerService.getInstance(
    BuilderPrdReviewService.name,
  );

  constructor(
    private readonly llmCompletion: LlmCompletionService,
    private readonly docRepository: BuilderPrdDocRepository,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly evidenceLog: BuilderEvidenceLogService,
    private readonly catalog: BuilderCatalogService,
  ) {}

  /**
   * The full review. Never throws: a failed call is recorded as a `failed`
   * review, which does not block and is retried on a later write.
   */
  async review(
    sessionId: string,
    doc: BuilderPrdDoc,
    options: { timeoutMs?: number } = {},
  ): Promise<BuilderPrdReview> {
    const now = new Date().toISOString();
    const previous = doc.review ?? null;
    let review: BuilderPrdReview;
    try {
      const [messages, evidence, systems] = await Promise.all([
        this.messageRepository.listBySession(sessionId),
        this.evidenceLog.renderForPrompt(sessionId, 120),
        Promise.resolve(renderSystemsForReview(this.catalog)),
      ]);
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.PRD_REVIEW,
        task: LlmTask.BUILDER_PRD_REVIEW,
        system: BUILDER_PRD_REVIEW_SYSTEM_PROMPT,
        maxTokens: REVIEW_MAX_TOKENS,
        jsonMode: true,
        timeoutMs: options.timeoutMs,
        usageMetadata: {
          builderSessionId: sessionId,
          mode: 'review',
          prdVersion: doc.versionNumber,
        },
        prompt: [
          '<prd>',
          prdForReview(doc.draft),
          '</prd>',
          '',
          '<evidence_log>',
          evidence || '(no lookups recorded)',
          '</evidence_log>',
          '',
          '<transcript>',
          renderTranscriptForReview(messages, TRANSCRIPT_BUDGET_CHARS) ||
            '(empty)',
          '</transcript>',
          '',
          '<reusable_systems>',
          systems || '(not available)',
          '</reusable_systems>',
        ].join('\n'),
      });
      if (result.stopReason === 'max_tokens') {
        throw new Error('the review was cut off at the output limit');
      }
      const findings = parseReviewFindings(result.text, doc.versionNumber);
      if (!findings) {
        throw new Error('the reviewer did not return a findings list');
      }
      review = {
        status: 'done',
        versionNumber: doc.versionNumber,
        checkedVersion: doc.versionNumber,
        model: result.model,
        reviewedAt: now,
        checkedAt: now,
        findings,
        error: null,
        failures: 0,
      };
      this.logger.info(
        `[BUILDER_PRD_REVIEW] session=${sessionId} v${doc.versionNumber} ` +
          `${result.provider}/${result.model}: ${findings.length} finding(s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Builder PRD review failed for session ${sessionId}: ${message}`,
      );
      review = {
        status: 'failed',
        versionNumber: doc.versionNumber,
        checkedVersion: doc.versionNumber,
        model: null,
        reviewedAt: now,
        checkedAt: now,
        findings: [],
        error: clip(message, 300),
        failures:
          (previous?.status === 'failed' ? (previous.failures ?? 1) : 0) + 1,
      };
    }
    return this.save(doc, review);
  }

  /**
   * Re-read the open findings against the current PRD. Closes the ones it
   * finds resolved; adds nothing. A failed call leaves the findings as they
   * were — they came from a review that worked, so they keep blocking.
   */
  async recheck(
    sessionId: string,
    doc: BuilderPrdDoc,
    options: { timeoutMs?: number } = {},
  ): Promise<BuilderPrdReview | null> {
    const review = doc.review;
    if (!review || review.status !== 'done') return review ?? null;
    const open = review.findings.filter((finding) => finding.status === 'open');
    if (!open.length || doc.versionNumber <= review.checkedVersion) {
      return review;
    }

    try {
      const messages = await this.messageRepository.listBySession(sessionId);
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.PRD_REVIEW,
        task: LlmTask.BUILDER_PRD_REVIEW,
        system: BUILDER_PRD_RECHECK_SYSTEM_PROMPT,
        maxTokens: REVIEW_MAX_TOKENS,
        jsonMode: true,
        timeoutMs: options.timeoutMs,
        usageMetadata: {
          builderSessionId: sessionId,
          mode: 'recheck',
          prdVersion: doc.versionNumber,
          openFindings: open.length,
        },
        prompt: [
          '<prd>',
          prdForReview(doc.draft),
          '</prd>',
          '',
          '<open_findings>',
          JSON.stringify(
            open.map(({ id, category, section, detail, fix, quote }) => ({
              id,
              category,
              section,
              detail,
              fix,
              ...(quote ? { quote } : {}),
            })),
            null,
            1,
          ),
          '</open_findings>',
          '',
          '<transcript_tail>',
          renderTranscriptForReview(
            messages,
            RECHECK_TRANSCRIPT_BUDGET_CHARS,
          ) || '(empty)',
          '</transcript_tail>',
        ].join('\n'),
      });
      const verdicts =
        result.stopReason === 'max_tokens' ? null : parseRecheck(result.text);
      if (!verdicts) {
        throw new Error('the recheck did not return a verdict list');
      }
      // A person may have dismissed a finding while the call ran. Their
      // decision wins over this pass's stale copy, so re-read before writing.
      const dismissedMeanwhile = await this.dismissedSince(doc.id);
      const now = new Date().toISOString();
      const updated: BuilderPrdReview = {
        ...review,
        checkedVersion: doc.versionNumber,
        checkedAt: now,
        findings: review.findings.map((finding) => {
          const dismissed = dismissedMeanwhile.get(finding.id);
          if (dismissed) return dismissed;
          const verdict = verdicts.get(finding.id);
          if (finding.status !== 'open' || !verdict) return finding;
          return verdict.resolved
            ? {
                ...finding,
                status: 'fixed',
                fixedInVersion: doc.versionNumber,
                checkNote: verdict.note,
              }
            : { ...finding, checkNote: verdict.note };
        }),
      };
      this.logger.info(
        `[BUILDER_PRD_REVIEW] recheck session=${sessionId} v${doc.versionNumber}: ` +
          `${
            updated.findings.filter((finding) => finding.status === 'open')
              .length
          } of ${open.length} still open`,
      );
      return this.save(doc, updated);
    } catch (error) {
      this.logger.warn(
        `Builder PRD recheck failed for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return review;
    }
  }

  /**
   * A person says a finding is wrong. Kept rather than deleted, with who,
   * when and why: a dismissed finding is either a reviewer mistake the eval
   * should learn from or a risk someone chose to take, and both need the
   * record.
   */
  async dismiss(
    doc: BuilderPrdDoc,
    findingId: string,
    reason: string,
    by: number,
    via: BuilderPrdReviewDismissal['via'],
  ): Promise<BuilderPrdReview> {
    const review = doc.review;
    const finding = review?.findings.find(
      (candidate) => candidate.id === String(findingId ?? '').trim(),
    );
    if (!review || !finding) {
      throw new BadRequestException(
        `No review finding "${findingId}" on this PRD.`,
      );
    }
    if (finding.status !== 'open') {
      throw new BadRequestException(
        `Finding ${finding.id} is already ${finding.status}.`,
      );
    }
    const trimmed = String(reason ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (trimmed.length < BUILDER_REVIEW_DISMISS_MIN_CHARS) {
      throw new BadRequestException(
        'Say why the finding is wrong — the reason is kept, and a one-word one ' +
          'teaches nothing.',
      );
    }
    const updated: BuilderPrdReview = {
      ...review,
      findings: review.findings.map((candidate) =>
        candidate.id === finding.id
          ? {
              ...candidate,
              status: 'dismissed',
              dismissal: {
                reason: trimmed.slice(0, DISMISS_MAX_CHARS),
                by,
                at: new Date().toISOString(),
                via,
              },
            }
          : candidate,
      ),
    };
    // Strict: a person pressed a button, and telling them it worked when it
    // did not would leave the finding blocking with no explanation.
    await this.docRepository.update({ id: doc.id }, { review: updated });
    doc.review = updated;
    return updated;
  }

  /** Findings the stored review now has dismissed, by id. Empty if unreadable. */
  private async dismissedSince(
    docId: string,
  ): Promise<Map<string, BuilderPrdReviewFinding>> {
    try {
      const current = await this.docRepository.findOne({
        where: { id: docId },
        select: { id: true, review: true },
      });
      return new Map(
        (current?.review?.findings ?? [])
          .filter((finding) => finding.status === 'dismissed')
          .map((finding) => [finding.id, finding]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Persist a reviewer result. A failed write is logged, not thrown: the
   * readiness computed from the in-memory copy is still right for this
   * request, and the next write reviews again.
   */
  private async save(
    doc: BuilderPrdDoc,
    review: BuilderPrdReview,
  ): Promise<BuilderPrdReview> {
    try {
      await this.docRepository.update({ id: doc.id }, { review });
    } catch (error) {
      this.logger.warn(
        `Builder PRD review for doc ${doc.id} not saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    doc.review = review;
    return review;
  }
}
