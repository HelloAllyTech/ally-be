import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HELPLINE_LIMITS,
  HelplinePresence,
  HelplineRiskOutcome,
} from '../constants/helpline.constants';

/**
 * Request bodies (contract §5). Shape checks live here; value rules that need
 * org settings (languages offered, the org's chat cap) live in the services.
 * `language` is lenient by design — an unoffered value falls back rather than
 * refusing a talker.
 */

export class CreateHelplineSessionDto {
  @ApiPropertyOptional({ maxLength: 40, example: 'Asha' })
  @IsOptional()
  @IsString()
  @MaxLength(HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS)
  displayName?: string;

  @ApiProperty({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  language?: string;

  @ApiProperty({ example: '2026-10-05' })
  @IsString()
  @MaxLength(32)
  consentVersion!: string;

  @ApiPropertyOptional({ maxLength: HELPLINE_LIMITS.MESSAGE_MAX_CHARS })
  @IsOptional()
  @IsString()
  @MaxLength(HELPLINE_LIMITS.MESSAGE_MAX_CHARS)
  firstMessage?: string;
}

export class HelplineAfterIdQueryDto {
  @ApiPropertyOptional({ description: 'Only messages with a larger id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterId?: number;
}

export class HelplineFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    maxLength: HELPLINE_LIMITS.FEEDBACK_COMMENT_MAX_CHARS,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HELPLINE_LIMITS.FEEDBACK_COMMENT_MAX_CHARS)
  comment?: string;
}

export class UpdateListenerProfileDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrentChats?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;
}

export class UpdatePresenceDto {
  @ApiProperty({ enum: [HelplinePresence.AVAILABLE, HelplinePresence.AWAY] })
  @IsIn([HelplinePresence.AVAILABLE, HelplinePresence.AWAY])
  status!: HelplinePresence.AVAILABLE | HelplinePresence.AWAY;
}

export class UpdateSummaryDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  fields!: Record<string, string>;
}

export class ListChatsQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'] })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  @ApiPropertyOptional({ enum: ['WAITING', 'ACTIVE', 'ENDED'] })
  @IsOptional()
  @IsIn(['WAITING', 'ACTIVE', 'ENDED'])
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: 25,
    maximum: HELPLINE_LIMITS.CHAT_LIST_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HELPLINE_LIMITS.CHAT_LIST_MAX_LIMIT)
  limit?: number;
}

export class AcknowledgeRiskFlagDto {
  @ApiProperty({
    enum: [HelplineRiskOutcome.CONFIRMED, HelplineRiskOutcome.FALSE_POSITIVE],
  })
  @IsIn([HelplineRiskOutcome.CONFIRMED, HelplineRiskOutcome.FALSE_POSITIVE])
  outcome!: HelplineRiskOutcome;

  @ApiPropertyOptional({ maxLength: HELPLINE_LIMITS.OUTCOME_NOTE_MAX_CHARS })
  @IsOptional()
  @IsString()
  @MaxLength(HELPLINE_LIMITS.OUTCOME_NOTE_MAX_CHARS)
  note?: string;
}

export class TeamQueryDto {
  @ApiPropertyOptional({ description: 'Name or email contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateTeamMemberDto {
  @ApiProperty()
  @IsBoolean()
  listener!: boolean;

  @ApiProperty()
  @IsBoolean()
  supervisor!: boolean;
}

export class AdminSettingsQueryDto {
  @ApiPropertyOptional({
    description:
      'Tenant uuid or code. Platform admins only; defaults to your own.',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class UpdateAdminSettingsDto {
  @ApiProperty({ description: 'Tenant uuid or code' })
  @IsString()
  tenantId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Partial HelplineSettings (contract §8)',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class CopilotFeedbackDto {
  @ApiProperty({ description: 'A SUGGESTION or NUDGE message id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  messageId!: number;

  @ApiPropertyOptional({
    description: 'Which suggestion (SUGGESTION rows only)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  index?: number;

  @ApiProperty({ enum: ['UP', 'DOWN'] })
  @IsIn(['UP', 'DOWN'])
  rating!: 'UP' | 'DOWN';
}

export class AlertSupervisorDto {
  @ApiPropertyOptional({
    maxLength: 300,
    description:
      'Staff-only note for the supervisor. Stored encrypted in the chat; never sent in a notification.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class TransferChatDto {
  @ApiPropertyOptional({ description: 'Aim the transfer at one listener' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetListenerId?: number;
}

export class AssignChatDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  listenerId!: number;
}

export class WhisperDto {
  @ApiProperty({ maxLength: HELPLINE_LIMITS.MESSAGE_MAX_CHARS })
  @IsString()
  @MaxLength(HELPLINE_LIMITS.MESSAGE_MAX_CHARS)
  content!: string;
}

export class BlockTalkerDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Not stored (free text about a person); the audit records only whether one was given',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
