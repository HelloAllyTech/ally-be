import {
  IsString,
  IsOptional,
  IsObject,
  Matches,
  Length,
  IsArray,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ description: 'Name of the tenant' })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9\s-_]+$/, {
    message:
      'Name can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  name!: string;

  @ApiProperty({ description: 'Unique code for the tenant' })
  @IsString()
  @Length(2, 20)
  @Matches(/^[a-zA-Z0-9-_]+$/, {
    message: 'Code can only contain letters, numbers, hyphens, and underscores',
  })
  code!: string;

  @ApiProperty({
    description: 'Organization URL of the scenario',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/org-logos/1730000000000-image.jpg',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'Description of the tenant', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Metadata for the tenant', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'Settings for the tenant', required: false })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;

  @ApiProperty({
    description: 'List of dashboard IDs to enable for the tenant',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  enabledDashboardIds?: string[];

  @ApiProperty({
    description: 'Enable microphone mode for the tenant',
  })
  @IsBoolean()
  @IsOptional()
  enableMicrophoneMode?: boolean;

  @ApiProperty({
    description: 'Enable audio upload for the tenant',
  })
  @IsBoolean()
  @IsOptional()
  enableAudioUpload?: boolean;

  /** @deprecated Dictation mode is retired; this value is accepted and ignored. */
  @ApiProperty({
    description:
      'Deprecated. Dictation mode is retired — accepted for backwards compatibility and ignored.',
    deprecated: true,
  })
  @IsBoolean()
  @IsOptional()
  enableDictationMode?: boolean;

  @ApiProperty({
    description: 'Hide rank in leaderboard for the tenant',
  })
  @IsBoolean()
  @IsOptional()
  hideRankInCommunity?: boolean;

  @ApiProperty({
    description:
      'Mark as an internal/demo/QA organization. Super-admin analytics ' +
      'excludes these organizations and their users entirely.',
  })
  @IsBoolean()
  @IsOptional()
  isTestOrganization?: boolean;
}
