import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsObject, IsString, MaxLength } from 'class-validator';

import {
  SelfAssessmentDueReason,
  SelfAssessmentTrigger,
} from '../enum/self-assessment.enum';

/**
 * The learner side of the self-efficacy instrument:
 *
 *  - GET  /v1/self-assessment/due — is one due for me now, and the questions.
 *  - POST /v1/self-assessment     — my answer.
 *
 * Both act on the caller only (the JWT's user and org); there is no way to
 * read or write another learner's answers here. This shape is a client
 * contract.
 */

export class SelfEfficacyItemDto {
  @ApiProperty({
    description:
      'Rubric skill key — the key to answer under in `responses` (e.g. `verbal`)',
  })
  skill!: string;

  @ApiProperty({
    description: 'The rubric’s own name for the skill (the item label)',
  })
  name!: string;

  @ApiProperty({
    description: 'Rubric tier, for grouping the items on screen',
    enum: ['engage', 'understand', 'support'],
  })
  tier!: string;

  @ApiProperty({ description: 'The question as the learner reads it' })
  prompt!: string;
}

export class SelfEfficacyScaleDto {
  @ApiProperty({ example: 0 })
  min!: number;

  @ApiProperty({ example: 10 })
  max!: number;

  @ApiProperty({
    description: 'Label for the low end of the scale',
    example: 'Not at all confident',
  })
  minLabel!: string;

  @ApiProperty({
    description: 'Label for the high end of the scale',
    example: 'Completely confident',
  })
  maxLabel!: string;
}

export class SelfEfficacyInstrumentDto {
  @ApiProperty({
    description: 'Send this back as `instrumentVersion`',
    example: 'v1',
  })
  version!: string;

  @ApiProperty({ description: 'Instruction shown once above the items' })
  stem!: string;

  @ApiProperty({ type: SelfEfficacyScaleDto })
  scale!: SelfEfficacyScaleDto;

  @ApiProperty({
    type: [SelfEfficacyItemDto],
    description: 'One item per helping skill, in the order to show them',
  })
  items!: SelfEfficacyItemDto[];
}

export class SelfAssessmentDueResponseDto {
  @ApiProperty({
    description:
      'True when the learner should be asked now. Show the instrument only when true',
  })
  due!: boolean;

  @ApiProperty({
    enum: SelfAssessmentTrigger,
    nullable: true,
    description:
      'Why it is due — send it back as `trigger` on submit. Null when not due',
  })
  trigger!: SelfAssessmentTrigger | null;

  @ApiProperty({
    enum: SelfAssessmentDueReason,
    description:
      'NEVER_ANSWERED / SCORED_CUTS / COURSE_COMPLETED when due; TOO_SOON (answered in the last 24 hours) or NOTHING_NEW when not',
  })
  reason!: SelfAssessmentDueReason;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ISO time of the learner’s last answer (or dismissal); null if never',
  })
  lastAnsweredAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'When `reason` is TOO_SOON: the earliest ISO time an answer is accepted. Null otherwise',
  })
  nextEligibleAt!: string | null;

  @ApiProperty({
    type: SelfEfficacyInstrumentDto,
    description: 'The current instrument, whether or not one is due',
  })
  instrument!: SelfEfficacyInstrumentDto;
}

export class SubmitSelfAssessmentDto {
  @ApiProperty({
    description:
      'The `instrument.version` the learner was shown. Only the current version is accepted',
    example: 'v1',
  })
  @IsString()
  @MaxLength(32)
  instrumentVersion!: string;

  @ApiProperty({
    enum: SelfAssessmentTrigger,
    description:
      'The `trigger` GET due returned. Must still be what the server would say now, or the submit is refused with 409',
  })
  @IsEnum(SelfAssessmentTrigger)
  trigger!: SelfAssessmentTrigger;

  @ApiProperty({
    description:
      '`{ skillKey: integer 0–10 }` for the items answered. Omit (or send null for) a skipped item — never 0 for "skipped". `{}` records a dismissed prompt, which resets the cadence like an answer',
    example: { verbal: 7, empathy: 8, harm: 4 },
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 0, maximum: 10 },
  })
  @IsObject()
  responses!: Record<string, number | null>;
}

export class SubmitSelfAssessmentResponseDto {
  @ApiProperty({
    description: 'learner_self_assessments.id of the stored answer',
  })
  id!: string;

  @ApiProperty({ description: 'Server time the answer was stored (ISO)' })
  answeredAt!: string;

  @ApiProperty({ enum: SelfAssessmentTrigger })
  trigger!: SelfAssessmentTrigger;

  @ApiProperty({
    description: 'Items answered; 0 for a dismissed prompt',
  })
  answeredItems!: number;
}
