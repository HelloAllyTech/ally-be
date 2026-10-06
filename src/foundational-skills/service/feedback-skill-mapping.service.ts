import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  FHS_MAX_ATTEMPTS,
  FHS_RUBRIC_VERSION,
} from '../constants/helping-skills-rubric.constants';
import {
  FEEDBACK_SKILL_MAPPER_CONCURRENCY,
  FEEDBACK_SKILL_MAPPER_MAX_ITEMS,
  FEEDBACK_SKILL_MAPPER_VERSION,
  FEEDBACK_SKILL_MAPPINGS_PER_TICK,
} from '../constants/feedback-skill-mapper.constants';
import { FeedbackSkillLinkStatus } from '../enum/feedback-skill-link.enum';
import {
  FeedbackSkillLinkWrite,
  FeedbackSkillMappingRepository,
  SessionToMap,
} from '../repository/feedback-skill-mapping.repository';
import { debriefImprovements } from '../util/feedback-skill-mapping.util';
import { FeedbackSkillMapperService } from './feedback-skill-mapper.service';

export interface FeedbackSkillMappingTickSummary {
  sessionsMapped: number;
  sessionsSkipped: number;
  sessionsFailed: number;
}

/**
 * Files each debrief's "areas of growth" under foundational helping skills, a
 * bounded batch per scheduler tick, so the Helping skills tab can compare the
 * skills a debrief named with the ones it did not (EFF-40, AAQ-221).
 *
 * Runs from the scheduler only (`FEEDBACK_SKILL_MAPPING_SCHEDULE`); nothing on
 * a request path calls it. Same retry contract as the FHS judge: a failure is
 * a FAILED row retried hourly up to `FHS_MAX_ATTEMPTS`; a debrief with nothing
 * to map is a final SKIPPED row with no model call.
 */
@Injectable()
export class FeedbackSkillMappingService {
  private readonly logger = LoggerService.getInstance(
    FeedbackSkillMappingService.name,
  );

  constructor(
    private readonly repository: FeedbackSkillMappingRepository,
    private readonly mapper: FeedbackSkillMapperService,
  ) {}

  async tick(): Promise<FeedbackSkillMappingTickSummary> {
    const queue = await this.repository.findSessionsToMap(
      FEEDBACK_SKILL_MAPPER_VERSION,
      FHS_RUBRIC_VERSION,
      FHS_MAX_ATTEMPTS,
      FEEDBACK_SKILL_MAPPINGS_PER_TICK,
    );
    const summary: FeedbackSkillMappingTickSummary = {
      sessionsMapped: 0,
      sessionsSkipped: 0,
      sessionsFailed: 0,
    };
    if (queue.length === 0) return summary;

    const debriefs = await this.repository.loadDebriefs(
      queue.map((s) => s.sessionId),
    );

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const status = await this.mapSession(
          next,
          debriefs.get(next.sessionId),
        );
        if (status === FeedbackSkillLinkStatus.MAPPED)
          summary.sessionsMapped += 1;
        else if (status === FeedbackSkillLinkStatus.SKIPPED)
          summary.sessionsSkipped += 1;
        else summary.sessionsFailed += 1;
      }
    };
    await Promise.all(
      Array.from({ length: FEEDBACK_SKILL_MAPPER_CONCURRENCY }, () => worker()),
    );

    this.logger.info(
      `feedback-skill-mapping tick: mapped=${summary.sessionsMapped} ` +
        `skipped=${summary.sessionsSkipped} failed=${summary.sessionsFailed} ` +
        `version=${FEEDBACK_SKILL_MAPPER_VERSION}`,
    );
    return summary;
  }

  /**
   * Map one session and record the outcome. Never throws. Logs carry ids and
   * counts only — never debrief text.
   */
  async mapSession(
    target: SessionToMap,
    feedback: unknown,
  ): Promise<FeedbackSkillLinkStatus> {
    const base: Pick<
      FeedbackSkillLinkWrite,
      'sessionId' | 'userId' | 'tenantId' | 'sessionEndedAt' | 'mapperVersion'
    > = {
      sessionId: target.sessionId,
      userId: target.userId,
      tenantId: target.tenantId,
      sessionEndedAt: target.endedAt,
      mapperVersion: FEEDBACK_SKILL_MAPPER_VERSION,
    };
    let itemCount = 0;
    try {
      const items = debriefImprovements(feedback);
      itemCount = items.length;

      const skipReason =
        items.length === 0
          ? 'Debrief has no improvement with any text'
          : items.length > FEEDBACK_SKILL_MAPPER_MAX_ITEMS
            ? `Debrief has ${items.length} improvements; more than ` +
              `${FEEDBACK_SKILL_MAPPER_MAX_ITEMS} is treated as malformed`
            : null;
      if (skipReason) {
        await this.repository.upsertLink({
          ...base,
          ...unmapped(),
          status: FeedbackSkillLinkStatus.SKIPPED,
          itemCount,
          error: skipReason,
        });
        return FeedbackSkillLinkStatus.SKIPPED;
      }

      const outcome = await this.mapper.map(items, {
        sessionId: target.sessionId,
        userId: target.userId,
      });
      if (outcome.invalidKeys > 0) {
        this.logger.warn(
          `feedback-skill-mapping: session ${target.sessionId} reply named ` +
            `${outcome.invalidKeys} key(s) outside the rubric; stored as null`,
        );
      }
      await this.repository.upsertLink({
        ...base,
        status: FeedbackSkillLinkStatus.MAPPED,
        itemCount,
        items: outcome.items,
        model: outcome.model,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        error: null,
      });
      return FeedbackSkillLinkStatus.MAPPED;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 500);
      this.logger.warn(
        `feedback-skill-mapping: session ${target.sessionId} failed ` +
          `(attempt ${target.attempts + 1}): ${message}`,
      );
      await this.repository
        .upsertLink({
          ...base,
          ...unmapped(),
          status: FeedbackSkillLinkStatus.FAILED,
          itemCount,
          error: message,
        })
        .catch(() => undefined);
      return FeedbackSkillLinkStatus.FAILED;
    }
  }
}

/** The result columns of a row that carries no mapping. */
function unmapped(): Pick<
  FeedbackSkillLinkWrite,
  'items' | 'model' | 'promptTokens' | 'completionTokens'
> {
  return { items: [], model: null, promptTokens: null, completionTokens: null };
}
