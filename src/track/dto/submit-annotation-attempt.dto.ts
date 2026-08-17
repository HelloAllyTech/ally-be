import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AnnotationMarkDto {
  @ApiProperty({ description: 'Id of the marked line/paragraph' })
  @IsString()
  @IsNotEmpty()
  unitId!: string;

  @ApiProperty({ description: 'Id of the label applied to it' })
  @IsString()
  @IsNotEmpty()
  labelId!: string;
}

export class SubmitAnnotationAttemptDto {
  @ApiProperty({
    type: [AnnotationMarkDto],
    description:
      'Every (line, label) pair the learner marked. Duplicates are collapsed server-side.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AnnotationMarkDto)
  marks!: AnnotationMarkDto[];
}
