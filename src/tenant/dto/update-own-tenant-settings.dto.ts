import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Settings-only subset of a tenant that a tenant ADMIN may edit for their OWN
 * tenant (via PATCH /v1/tenants/self/settings). Intentionally excludes name,
 * code, description and logoUrl — a tenant admin can flip feature toggles but
 * cannot rename or re-key their organization. The target tenant is always the
 * caller's own tenant (derived from the JWT), never a client-supplied id.
 */
export class UpdateOwnTenantSettingsDto {
  @ApiProperty({
    description: 'List of analytics dashboard IDs enabled for the tenant',
    type: [String],
    required: false,
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  enabledDashboardIds?: string[];

  @ApiProperty({ description: 'Enable microphone mode', required: false })
  @IsBoolean()
  @IsOptional()
  enableMicrophoneMode?: boolean;

  @ApiProperty({ description: 'Enable audio upload', required: false })
  @IsBoolean()
  @IsOptional()
  enableAudioUpload?: boolean;

  @ApiProperty({ description: 'Enable dictation mode', required: false })
  @IsBoolean()
  @IsOptional()
  enableDictationMode?: boolean;

  @ApiProperty({
    description: 'Hide the tenant’s rank in the community leaderboard',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  hideRankInCommunity?: boolean;
}
