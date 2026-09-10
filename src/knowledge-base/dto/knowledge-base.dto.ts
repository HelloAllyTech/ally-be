import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  KB_MAX_FILE_SIZE_BYTES,
  KB_MAX_PASTE_CHARS,
} from '../constants/knowledge-base.constants';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';

export class CreateKbUploadUrlDto {
  @ApiProperty({ description: 'Original file name, used for the S3 key' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ description: 'Size in bytes; rejected above the cap' })
  @IsInt()
  @Min(1)
  @Max(KB_MAX_FILE_SIZE_BYTES)
  fileSize!: number;

  @ApiProperty({
    description:
      'MIME type. Only the three document formats are accepted here; pasted text and URLs ' +
      'need no upload.',
    enum: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/epub+zip',
    ],
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;
}

export class KbUploadUrlResponseDto {
  @ApiProperty() presignedUrl!: string;
  @ApiProperty({
    description: 'Pass this back as fileUrl when creating the document',
  })
  fileUrl!: string;
}

export class CreateKbDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @ApiProperty({ enum: KbDocumentSourceType })
  @IsEnum(KbDocumentSourceType)
  sourceType!: KbDocumentSourceType;

  @ApiPropertyOptional({
    description: `Body text for sourceType=paste. Max ${KB_MAX_PASTE_CHARS} characters.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(KB_MAX_PASTE_CHARS)
  text?: string;

  @ApiPropertyOptional({ description: 'Public URL for sourceType=url' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  sourceUrl?: string;

  @ApiPropertyOptional({
    description: 'The fileUrl returned by upload-url, for pdf/docx/epub',
  })
  @IsOptional()
  @IsString()
  fileUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() fileName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sizeBytes?: number;

  @ApiPropertyOptional({ description: 'BCP-47 tag; detected when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Available to every organisation. Defaults to FALSE, so a caller that omits both this ' +
      'and tenantIds creates a document nobody can retrieve — a visible, one-click-fixable ' +
      'state, unlike an accidentally over-shared one.',
  })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Organisations this document is available to. Ignored when isGlobal is true, rather ' +
      'than rejected: an admin who ticks "all organisations" after picking a few should not ' +
      'have to undo the picks.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tenantIds?: string[];
}

export class UpdateKbDocumentAudienceDto {
  @ApiProperty({ description: 'Available to every organisation' })
  @IsBoolean()
  isGlobal!: boolean;

  @ApiPropertyOptional({
    type: [String],
    default: [],
    description:
      'Organisations that may retrieve it when isGlobal is false. An empty list with ' +
      'isGlobal false is accepted: "available to nobody" is a legitimate way to take a ' +
      'document out of circulation without archiving it.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tenantIds?: string[];
}

export class UpdateKbDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;
}

export class ReplaceKbDocumentContentDto {
  @ApiProperty({
    description:
      'Replacement body for a pasted document. Re-chunks and re-indexes only when the text ' +
      'actually changed.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(KB_MAX_PASTE_CHARS)
  text!: string;
}

export class GetKbDocumentsQueryDto {
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    description: 'Matches the title or the document body',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: KbDocumentStatus })
  @IsOptional()
  @IsEnum(KbDocumentStatus)
  status?: KbDocumentStatus;

  @ApiPropertyOptional({ enum: KbDocumentSourceType })
  @IsOptional()
  @IsEnum(KbDocumentSourceType)
  sourceType?: KbDocumentSourceType;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Only documents this organisation can retrieve — its own plus the global ones. This is ' +
      'the "what does this customer actually see" view, which is the question an admin asks ' +
      'when a worker reports a gap.',
  })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Include archived documents; the management list wants them, the picker does not',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  /**
   * Sort key and direction. Both are whitelisted server-side, so an unknown key falls back to the
   * default order rather than 400ing — a stale bookmark should render, not break.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortDir?: string;
}

export class KbDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: KbDocumentSourceType })
  sourceType!: KbDocumentSourceType;
  @ApiProperty({ nullable: true }) sourceUrl!: string | null;
  @ApiProperty({ nullable: true }) fileName!: string | null;
  @ApiProperty({ nullable: true }) contentType!: string | null;
  @ApiProperty({ nullable: true }) sizeBytes!: number | null;
  @ApiProperty({ nullable: true }) language!: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ enum: KbDocumentStatus }) status!: KbDocumentStatus;
  @ApiProperty({
    nullable: true,
    description:
      'The failure reason, verbatim, for the admin table. Surfaced rather than logged because a ' +
      'generic message makes an encrypted PDF indistinguishable from an oversized one.',
  })
  statusMessage!: string | null;
  @ApiProperty() chunkCount!: number;
  @ApiProperty() indexedChunkCount!: number;
  @ApiProperty({ description: 'Available to every organisation' })
  isGlobal!: boolean;
  @ApiProperty({
    type: [String],
    description:
      'Organisations it is targeted at. Always empty when isGlobal is true — the rows are ' +
      'not consulted in that case, so returning them would invite a UI that shows a global ' +
      'document as restricted.',
  })
  tenantIds!: string[];
  @ApiProperty() isArchived!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class GetKbDocumentsResponseDto {
  @ApiProperty({ type: [KbDocumentResponseDto] })
  documents!: KbDocumentResponseDto[];
  @ApiProperty() count!: number;
}

export class KbChunkResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() chunkIndex!: number;
  @ApiProperty() text!: string;
  @ApiProperty() charStart!: number;
  @ApiProperty() charEnd!: number;
  @ApiProperty({ description: '0 when the format has no pages' })
  pageFrom!: number;
  @ApiProperty() pageTo!: number;
  @ApiProperty({ nullable: true }) sectionPath!: string | null;
  @ApiProperty() tokenCount!: number;
  @ApiProperty() uploadStatus!: string;
  @ApiProperty({ nullable: true }) uploadError!: string | null;
}

export class GetKbChunksResponseDto {
  @ApiProperty({ type: [KbChunkResponseDto] }) chunks!: KbChunkResponseDto[];
  @ApiProperty() count!: number;
}

export class KbSearchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    default: 0.35,
    description:
      'Cosine similarity floor. Exposed so an admin can tune retrieval live.',
  })
  @IsOptional()
  @Type(() => Number)
  minSimilarity?: number;

  @ApiPropertyOptional({
    description:
      'Retrieve as a worker from this organisation would — its documents plus the global ' +
      'ones. Omitted, this searches the WHOLE corpus regardless of targeting, which is the ' +
      'right default for a console whose job is to show what is indexed.',
  })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;
}

export class KbStatsResponseDto {
  @ApiProperty({ description: 'Document counts keyed by status' })
  byStatus!: Record<string, number>;
  @ApiProperty() totalChunks!: number;
  @ApiProperty() indexedChunks!: number;
}
