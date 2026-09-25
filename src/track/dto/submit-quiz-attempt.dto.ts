import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class QuizAnswerPairDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  leftId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  rightId!: string;
}

export class QuizAnswerBlankDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  blankId!: string;

  @ApiProperty()
  @IsString()
  answer!: string;
}

export class QuizAnswerRatingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  statementId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scaleOptionId!: string;
}

export class QuizAnswerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanAnswer?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderedItemIds?: string[];

  @ApiPropertyOptional({ type: [QuizAnswerPairDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerPairDto)
  pairs?: QuizAnswerPairDto[];

  @ApiPropertyOptional({ type: [QuizAnswerBlankDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerBlankDto)
  blanks?: QuizAnswerBlankDto[];

  @ApiPropertyOptional({ description: 'Open-ended answer text' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    type: [QuizAnswerRatingDto],
    description: 'Rating-scale answer: one scale point per statement',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerRatingDto)
  ratings?: QuizAnswerRatingDto[];
}

export class SubmitQuizAttemptDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
