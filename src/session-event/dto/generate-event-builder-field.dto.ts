import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  EventBuilderField,
  MAX_EXAMPLES_PER_POLARITY,
} from '../enum/event-builder-field.enum';

/** Upper bound on the free-text brief, so one paste cannot blow the context. */
const MAX_BRIEF_LENGTH = 4000;

/**
 * One field-generation call for Event Builder: turn a free-text description of
 * a behaviour ("the counsellor asks an open-ended question that invites the
 * caller to say more") into the configuration of a BINARY_CLASSIFIER session
 * event.
 *
 * The client fires one of these per target field. `classifier` goes first and
 * its `className` is fed back in on the rest (see
 * CLASSNAME_DEPENDENT_EVENT_BUILDER_FIELDS), so the examples and feedback
 * describe the class the author actually kept rather than one the model
 * re-imagined per call.
 *
 * Generation does not persist anything. The response is a value for a form the
 * author edits and submits through the normal create/update endpoints, so a
 * brief that produces a bad classifier leaves nothing behind in the (global,
 * cross-tenant) event catalogue.
 */
export class GenerateEventBuilderFieldDto {
  @ApiProperty({
    description: 'Which part of the event to generate',
    enum: EventBuilderField,
    example: EventBuilderField.CLASSIFIER,
  })
  @IsEnum(EventBuilderField)
  @IsNotEmpty()
  field!: EventBuilderField;

  @ApiProperty({
    description:
      'Free-text description of the behaviour to detect, written by the ' +
      'studio author.',
    example:
      'The counsellor asks an open-ended question that invites the caller to ' +
      'say more, rather than a yes/no question.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_BRIEF_LENGTH)
  eventDescription!: string;

  @ApiProperty({
    description:
      'The classification class this event detects, as the author has it ' +
      "right now — normally the `classifier` call's answer, possibly edited. " +
      'Read by the examples / feedback / branch_instruction fields; ignored ' +
      'by `classifier` and `tags`. When omitted those fields fall back to the ' +
      'brief alone, which still works but generates weaker examples.',
    required: false,
    example: 'Open-ended question',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  className?: string;

  @ApiProperty({
    description:
      'What the simulation is about (title, or title + challenge), so the ' +
      'generated wording fits the scenario the event will be mapped onto.',
    required: false,
    example:
      'Supporting a caregiver who has just received a dementia diagnosis',
  })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_BRIEF_LENGTH)
  simulationContext?: string;

  @ApiProperty({
    description: 'Competency being practised, if the studio has one selected',
    required: false,
    example: 'Active listening',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  competency?: string;

  @ApiProperty({
    description:
      'How many few-shot examples to produce PER POLARITY (only read by the ' +
      '`examples` field). Capped server-side — every example is re-sent on ' +
      'every learner turn at runtime.',
    required: false,
    minimum: 1,
    maximum: MAX_EXAMPLES_PER_POLARITY,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_EXAMPLES_PER_POLARITY)
  @IsOptional()
  numExamples?: number;

  @ApiProperty({
    description: 'Model override for generation',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'AI provider override; normally follows from the model',
    required: false,
  })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({
    description:
      'LLM sampling temperature (0–2). Overrides the prompt-level default.',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  temperature?: number;
}

export class GenerateEventBuilderFieldResponseDto {
  @ApiProperty({ enum: EventBuilderField })
  field!: EventBuilderField;

  @ApiProperty({
    description:
      'Parsed field value. Shape depends on `field`: ' +
      '{name,className} for classifier; ' +
      '{positiveExamples:[{text}],negativeExamples:[{text}]} for examples; ' +
      '{message,emoji?,score} for feedback; ' +
      'string for branch_instruction; string[] for tags. ' +
      'Every value is already clamped to what the event columns accept, so it ' +
      'can be written straight into the draft form.',
  })
  value!: unknown;
}
