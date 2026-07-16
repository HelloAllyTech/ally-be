import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LabEvalQuestionType } from '../entity/lab-eval-question.entity';
import {
  EVAL_RATING_SCALE_MAX,
  EVAL_RATING_SCALE_MIN,
} from '../constants/lab-eval.constants';

/** One evaluation question supplied at publish time. */
export class PublishRunQuestionDto {
  @ApiProperty({ description: 'The question text shown to evaluators' })
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiProperty({ enum: LabEvalQuestionType })
  @IsEnum(LabEvalQuestionType)
  type!: LabEvalQuestionType;

  @ApiPropertyOptional({
    description: `Rating scale maximum (RATING questions only, ${EVAL_RATING_SCALE_MIN}-${EVAL_RATING_SCALE_MAX}); scale is 1..max`,
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(EVAL_RATING_SCALE_MIN)
  @Max(EVAL_RATING_SCALE_MAX)
  scaleMax?: number;
}

export class PublishRunDto {
  @ApiProperty({
    type: [PublishRunQuestionDto],
    description: 'Human-eval questions; at least one is required',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublishRunQuestionDto)
  questions!: PublishRunQuestionDto[];
}

export class AssignRunDto {
  @ApiProperty({
    description: 'Evaluators to assign this published run to',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  evaluatorIds!: string[];
}

export class CreateLabEvaluatorDto {
  @ApiProperty({ description: 'Unique evaluator email address' })
  @IsEmail()
  email!: string;
}

export class EvaluatorLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

/** One answer in an evaluation submission. */
export class SubmitEvalAnswerDto {
  @ApiProperty()
  @IsUUID()
  questionId!: string;

  @ApiPropertyOptional({ description: 'RATING answer (within the scale)' })
  @IsOptional()
  @IsInt()
  rating?: number;

  @ApiPropertyOptional({ description: 'YES_NO answer' })
  @IsOptional()
  @IsBoolean()
  yesNo?: boolean;

  @ApiPropertyOptional({ description: 'Open-ended TEXT answer' })
  @IsOptional()
  @IsString()
  text?: string;
}

export class SubmitEvaluationDto {
  @ApiProperty({ type: [SubmitEvalAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitEvalAnswerDto)
  answers!: SubmitEvalAnswerDto[];
}
