import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FHS_RUBRIC_VERSION } from '../constants/helping-skills-rubric.constants';
import {
  SELF_EFFICACY_INSTRUMENT_VERSION,
  SELF_EFFICACY_INSTRUMENT_VERSIONS,
  SelfEfficacyInstrument,
  currentSelfEfficacyInstrument,
} from '../constants/self-efficacy-instrument.constants';
import {
  SelfAssessmentDueResponseDto,
  SelfEfficacyInstrumentDto,
  SubmitSelfAssessmentDto,
  SubmitSelfAssessmentResponseDto,
} from '../dto/self-assessment.dto';
import { SelfAssessmentTrigger } from '../enum/self-assessment.enum';
import {
  QueryRunnerLike,
  SelfAssessmentRepository,
} from '../repository/self-assessment.repository';
import {
  SelfAssessmentDue,
  SelfAssessmentDueFacts,
  recordsCutCount,
  selfAssessmentDue,
  validateSelfAssessmentResponses,
} from '../util/self-assessment-due.util';

/** The caller, as the JWT names them. */
export interface SelfAssessmentCaller {
  id: number;
  tenantId: string | null | undefined;
}

export function toInstrumentDto(
  instrument: SelfEfficacyInstrument,
): SelfEfficacyInstrumentDto {
  return {
    version: instrument.version,
    stem: instrument.stem,
    scale: {
      min: instrument.scale.min,
      max: instrument.scale.max,
      minLabel: instrument.scale.anchors.min,
      maxLabel: instrument.scale.anchors.max,
    },
    items: instrument.items.map((i) => ({
      skill: i.skill,
      name: i.name,
      tier: i.tier,
      prompt: i.prompt,
    })),
  };
}

/**
 * The learner's side of the self-efficacy instrument: "is one due?" and the
 * submit. Both apply the same pure due rule to the same facts, and the submit
 * re-derives them inside a transaction holding a per-learner advisory lock, so
 * what the learner was told is what is enforced and a double-tapped submit
 * stores one answer, not two.
 *
 * Refusals: 400 for an unknown or retired instrument version or a malformed
 * answer (every problem named), 409 when no answer is due (answered in the
 * last 24 hours, or nothing new since the last one) or when the due trigger is
 * no longer the one the client was given — the client re-reads GET due and
 * either resubmits with the new trigger or drops the answer.
 */
@Injectable()
export class SelfAssessmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: SelfAssessmentRepository,
  ) {}

  async getDue(
    userId: number,
    now: Date = new Date(),
  ): Promise<SelfAssessmentDueResponseDto> {
    const facts = await this.facts(userId, now, this.dataSource);
    const due = selfAssessmentDue(facts);
    return {
      due: due.due,
      trigger: due.trigger,
      reason: due.reason,
      lastAnsweredAt: facts.last ? facts.last.answeredAt.toISOString() : null,
      nextEligibleAt: due.nextEligibleAt
        ? due.nextEligibleAt.toISOString()
        : null,
      instrument: toInstrumentDto(currentSelfEfficacyInstrument()),
    };
  }

  async submit(
    caller: SelfAssessmentCaller,
    dto: SubmitSelfAssessmentDto,
    now: Date = new Date(),
  ): Promise<SubmitSelfAssessmentResponseDto> {
    if (!caller?.id) throw new UnauthorizedException('Unauthorized access');
    if (!caller.tenantId) {
      throw new BadRequestException(
        'Your account is not in an organisation, so a self-assessment cannot be stored',
      );
    }

    if (dto.instrumentVersion !== SELF_EFFICACY_INSTRUMENT_VERSION) {
      throw new BadRequestException(
        SELF_EFFICACY_INSTRUMENT_VERSIONS.includes(dto.instrumentVersion)
          ? `Instrument ${dto.instrumentVersion} is retired; answer ${SELF_EFFICACY_INSTRUMENT_VERSION}`
          : `Unknown instrument version "${dto.instrumentVersion}"`,
      );
    }
    const instrument = currentSelfEfficacyInstrument();
    const checked = validateSelfAssessmentResponses(instrument, dto.responses);
    if (!checked.ok) throw new BadRequestException(checked.errors);

    return this.dataSource.transaction(async (manager) => {
      await this.repository.lockLearner(caller.id, manager);
      const due = selfAssessmentDue(await this.facts(caller.id, now, manager));
      assertSubmittable(due, dto.trigger);

      const stored = await this.repository.insert(
        {
          userId: caller.id,
          tenantId: String(caller.tenantId),
          instrumentVersion: instrument.version,
          trigger: due.trigger as SelfAssessmentTrigger,
          triggerRef: due.triggerRef,
          responses: checked.responses,
          answeredAt: now,
        },
        manager,
      );
      return {
        id: stored.id,
        answeredAt: stored.answeredAt.toISOString(),
        trigger: due.trigger as SelfAssessmentTrigger,
        answeredItems: Object.keys(checked.responses).length,
      };
    });
  }

  /** Everything the due rule reads, gathered from one runner. */
  private async facts(
    userId: number,
    now: Date,
    runner: QueryRunnerLike,
  ): Promise<SelfAssessmentDueFacts> {
    const last = await this.repository.findLast(userId, runner);
    // A CUTS answer carries its count; anything else is recounted at its time.
    const needsRecount = !!last && !recordsCutCount(last);
    const [scoredCuts, scoredCutsAtLast, courseCompletedSince] =
      await Promise.all([
        this.repository.countScoredCuts(
          userId,
          FHS_RUBRIC_VERSION,
          undefined,
          runner,
        ),
        needsRecount && last
          ? this.repository.countScoredCuts(
              userId,
              FHS_RUBRIC_VERSION,
              last.answeredAt,
              runner,
            )
          : Promise.resolve(0),
        this.repository.latestCourseCompletionSince(
          userId,
          last ? last.answeredAt : null,
          runner,
        ),
      ]);
    return { now, last, scoredCuts, scoredCutsAtLast, courseCompletedSince };
  }
}

/**
 * The submit is accepted only when an answer is due AND for the trigger the
 * server would give now. Exported for the spec.
 */
export function assertSubmittable(
  due: SelfAssessmentDue,
  trigger: SelfAssessmentTrigger,
): void {
  if (!due.due || !due.trigger) {
    throw new ConflictException(
      due.nextEligibleAt
        ? `No self-assessment is due: one was answered in the last 24 hours (next from ${due.nextEligibleAt.toISOString()})`
        : 'No self-assessment is due: nothing has changed since the last answer',
    );
  }
  if (due.trigger !== trigger) {
    throw new ConflictException(
      `The self-assessment due now is ${due.trigger}, not ${trigger} — fetch GET /v1/self-assessment/due and resubmit`,
    );
  }
}
