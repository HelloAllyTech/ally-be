import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsInt()
  default_language_id?: number;

  // Ordered list of admin-dashboard sidebar item ids (per-user nav ordering).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  admin_sidebar_order?: string[];

  // Consumer web app UI theme id (e.g. 'daylight', 'midnight', 'forest',
  // 'sunset', 'ocean'). The canonical value set + validity guard live in the
  // frontend (ally-web apps/ally-helpline-dashboard/src/theme/themes.ts); kept
  // loose here like the other keys so adding a theme needs no backend deploy.
  @IsOptional()
  @IsString()
  ui_theme?: string;

  // Per-user opt-out for the daily "your streak is at risk" email. Absent means
  // opted in; only an explicit false suppresses the reminder (see
  // StreakReminderService.getAtRiskRecipients).
  @IsOptional()
  @IsBoolean()
  streak_reminder_enabled?: boolean;

  // Per-user ordering of the Organization Metrics chart/table blocks
  // (ally-helpline-dashboard Statistics page, Org tab). Array of block ids
  // from ORG_METRICS_BLOCK_IDS in ally-web; validated loosely here (just
  // "array of strings") so adding/removing a block needs no backend deploy —
  // the frontend drops unknown/stale ids and appends any missing ones at the
  // end (see OrganizationMetrics.tsx's resolveLayout).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  org_metrics_layout?: string[];
}
