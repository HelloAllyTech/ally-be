import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderPrdDoc } from '../entity/builder-prd-doc.entity';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderMessageRole } from '../enum/builder.enum';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderPrdVersionRepository } from '../repository/builder-prd.repository';
import {
  BuilderPrdReadiness,
  BuilderReadinessSignals,
} from '../type/builder-prd.type';
import { isAcknowledgement } from '../util/builder-readiness-checks.util';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderCatalogService } from './builder-catalog.service';
import { BuilderEvidenceLogService } from './builder-evidence-log.service';
import { BuilderPrdReviewService } from './builder-prd-review.service';

/**
 * Where a readiness assessment is happening, which decides what the reviewer
 * may do there.
 *
 * - `edit` — inside the agent's `update_prd`. Runs the first review the
 *   moment everything else passes, so the agent reads the findings in the same
 *   turn it can fix them. Nothing more: a recheck after every patch would put
 *   a model call in front of each edit.
 * - `turn_end` — the interview turn settling. Runs a first review the edit
 *   path missed, retries a failed one, and rechecks open findings.
 * - `admin_edit` — an admin's section edit. Same as `turn_end`, under a
 *   shorter timeout because a person is waiting on the save.
 */
export type BuilderReadinessOccasion = 'edit' | 'turn_end' | 'admin_edit';

/** What the reviewer will do on this occasion, if anything. */
export type BuilderReviewPlan = 'review' | 'recheck' | null;

/** Consecutive failed reviews before the reviewer stops being retried. */
const MAX_REVIEW_FAILURES = 3;

/** An admin's save waits on this; the load balancer cuts requests at 60 s. */
const ADMIN_EDIT_REVIEW_TIMEOUT_MS = 45_000;
const TURN_REVIEW_TIMEOUT_MS = 150_000;

/** "[answers question q1] " — how a card answer is prefixed in the transcript. */
const ANSWER_PREFIX = /^\[answers question [^\]]*\]\s*/;

/**
 * What the admin said in their own words in a user message, or null when the
 * message was a pick from a card. A card answer with custom text counts — the
 * custom text is free text.
 */
export function freeTextOf(message: BuilderMessage): string | null {
  const answer = message.metadata?.answer;
  if (answer) {
    const custom = Array.isArray(answer.customValues)
      ? (answer.customValues as unknown[])
          .map(String)
          .filter((value) => value.trim())
      : [];
    return custom.length ? custom.join('\n') : null;
  }
  const text = String(message.content ?? '')
    .replace(ANSWER_PREFIX, '')
    .trim();
  return text || null;
}

/**
 * The message the "latest message is in the PRD" row checks: the admin's
 * latest message, if it said something in their own words that was more than
 * an acknowledgement. Null otherwise — including when the latest message is a
 * card pick or an "ok, thanks", which is also how an admin clears the row when
 * their words needed no edit.
 */
export function lastAdminMessageToApply(
  messages: BuilderMessage[],
): { text: string; at: Date } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== BuilderMessageRole.USER) continue;
    const text = freeTextOf(message);
    if (!text || isAcknowledgement(text)) return null;
    return { text, at: new Date(message.createdAt) };
  }
  return null;
}

/**
 * Readiness with the facts the draft alone cannot give: the platform's
 * web/mobile twins, what the session read, the admin's latest words, and the
 * cold reviewer.
 *
 * `BuilderPrdService.computeReadiness` stays a pure function of the draft and
 * these signals; this service gathers them, and decides when the reviewer
 * runs. Read paths call `assess` (never a model call); write paths call
 * `settle`, which may run the reviewer before answering.
 */
@Injectable()
export class BuilderReadinessService {
  private readonly logger = LoggerService.getInstance(
    BuilderReadinessService.name,
  );

  constructor(
    private readonly prdService: BuilderPrdService,
    private readonly catalog: BuilderCatalogService,
    private readonly evidenceLog: BuilderEvidenceLogService,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly versionRepository: BuilderPrdVersionRepository,
    private readonly reviewService: BuilderPrdReviewService,
  ) {}

  /**
   * Everything the rubric checks beyond the draft. Each source fails soft:
   * a signal that cannot be read is left undefined, which leaves its check
   * out rather than blocking every PRD on a database hiccup.
   */
  async gatherSignals(
    sessionId: string,
    doc: BuilderPrdDoc,
  ): Promise<BuilderReadinessSignals> {
    const [parityTwins, evidence, messages, lastPrdEditAt] = await Promise.all([
      this.catalog.parityTwins().catch((error: unknown) => {
        this.logger.warn(
          `Parity twins unavailable for readiness: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }),
      this.evidenceLog.readOutcomes(sessionId),
      this.messageRepository
        .listBySession(sessionId)
        .catch(() => undefined as BuilderMessage[] | undefined),
      this.versionRepository
        .latestCreatedAt(doc.id)
        .catch(() => undefined as Date | null | undefined),
    ]);
    return {
      parityTwins,
      evidence,
      ...(messages && lastPrdEditAt !== undefined
        ? {
            lastAdminMessage: lastAdminMessageToApply(messages),
            lastPrdEditAt,
          }
        : {}),
      review: doc.review ?? null,
    };
  }

  /** Readiness for a read path. Never calls a model. */
  async assess(
    sessionId: string,
    doc: BuilderPrdDoc,
  ): Promise<BuilderPrdReadiness> {
    return this.prdService.computeReadiness(
      doc.draft,
      await this.gatherSignals(sessionId, doc),
    );
  }

  /**
   * Readiness for a write path, and what the reviewer should do about it.
   * Split from `settle` so the interview can tell the admin a review is
   * running before it waits on one.
   */
  async plan(
    sessionId: string,
    doc: BuilderPrdDoc,
    occasion: BuilderReadinessOccasion,
  ): Promise<{ readiness: BuilderPrdReadiness; review: BuilderReviewPlan }> {
    const readiness = await this.assess(sessionId, doc);
    return { readiness, review: this.reviewPlan(readiness, doc, occasion) };
  }

  /** Run what `plan` decided, and return readiness as it now stands. */
  async runReview(
    sessionId: string,
    doc: BuilderPrdDoc,
    plan: BuilderReviewPlan,
    occasion: BuilderReadinessOccasion,
  ): Promise<BuilderPrdReadiness> {
    const timeoutMs =
      occasion === 'admin_edit'
        ? ADMIN_EDIT_REVIEW_TIMEOUT_MS
        : TURN_REVIEW_TIMEOUT_MS;
    if (plan === 'review') {
      await this.reviewService.review(sessionId, doc, { timeoutMs });
    } else if (plan === 'recheck') {
      await this.reviewService.recheck(sessionId, doc, { timeoutMs });
    }
    return this.assess(sessionId, doc);
  }

  /** `plan` then `runReview`, for callers with nothing to say in between. */
  async settle(
    sessionId: string,
    doc: BuilderPrdDoc,
    occasion: BuilderReadinessOccasion,
  ): Promise<BuilderPrdReadiness> {
    const { readiness, review } = await this.plan(sessionId, doc, occasion);
    return review
      ? this.runReview(sessionId, doc, review, occasion)
      : readiness;
  }

  /**
   * Whether the reviewer runs now. Only once every other row passes — a PRD
   * still missing sections is not worth a reviewer's read, and its findings
   * would be about gaps the rubric already names.
   */
  reviewPlan(
    readiness: BuilderPrdReadiness,
    doc: BuilderPrdDoc,
    occasion: BuilderReadinessOccasion,
  ): BuilderReviewPlan {
    const othersPass = readiness.sections
      .filter((section) => section.key !== 'prdReview')
      .every((section) => section.ok);
    if (!othersPass) return null;

    const review = doc.review ?? null;
    if (!review) return 'review';
    if (occasion === 'edit') return null;
    if (review.status === 'failed') {
      return (review.failures ?? 1) < MAX_REVIEW_FAILURES ? 'review' : null;
    }
    const open = review.findings.some((finding) => finding.status === 'open');
    return open && doc.versionNumber > review.checkedVersion ? 'recheck' : null;
  }
}
