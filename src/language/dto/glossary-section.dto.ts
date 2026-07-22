import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GlossaryInjectionMode } from '../entity/language-glossary-section.entity';

/** Sections are plain markdown; consolidation proposals are managed via the
 * dedicated accept/reject endpoints, never through upsert. */
export class UpsertGlossarySectionDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  /** The glossary body: markdown, served to the agent as-is. */
  @IsString()
  @MaxLength(50000)
  content!: string;

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
