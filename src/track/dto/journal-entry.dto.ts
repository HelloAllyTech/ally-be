import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

export class JournalResponseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  promptId!: string;

  @ApiProperty()
  @IsString()
  response!: string;
}

export class SaveJournalDraftsDto {
  @ApiProperty({ type: [JournalResponseDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => JournalResponseDto)
  responses!: JournalResponseDto[];
}
