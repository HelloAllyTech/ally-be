import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_GLOSSARY_ENTRIES_PER_SECTION } from '../constants/glossary.constants';
import {
  GlossaryEntryStatus,
  GlossaryInjectionMode,
} from '../entity/language-glossary-section.entity';

export class GlossaryEntryDto {
  @IsUUID()
  id!: string;

  @IsIn(['term_pair', 'rule', 'pattern'])
  type!: 'term_pair' | 'rule' | 'pattern';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  english?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  preferred?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avoid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  examples?: string[];

  @IsEnum(GlossaryEntryStatus)
  status!: GlossaryEntryStatus;

  @IsOptional()
  @IsInt()
  importance?: number;

  @IsOptional()
  @IsObject()
  provenance?: Record<string, unknown>;
}

export class UpsertGlossarySectionDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsArray()
  @ArrayMaxSize(MAX_GLOSSARY_ENTRIES_PER_SECTION)
  @ValidateNested({ each: true })
  @Type(() => GlossaryEntryDto)
  entries!: GlossaryEntryDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  retrievalHint?: string;

  @IsEnum(GlossaryInjectionMode)
  injectionMode!: GlossaryInjectionMode;

  @IsOptional()
  @IsInt()
  importance?: number;
}
