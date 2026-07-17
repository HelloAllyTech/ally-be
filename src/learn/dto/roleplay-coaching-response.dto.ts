import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Learner-facing coaching report for a Roleplay Studio v2 (ROLEPLAY_V2) session.
 * Surfaces the spec-based per-turn telemetry (rubric behaviors + rationale, the
 * emotional state journey, disclosures reached, and the Director's per-turn
 * coaching) that was previously admin-only. Additive to the generic v1 clinical
 * evaluation, which continues to be served alongside it.
 */

export class RoleplayCoachingBehaviorDto {
  @ApiProperty() behaviorId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['helpful', 'unhelpful'] })
  polarity!: 'helpful' | 'unhelpful';
  /** How many turns the Director observed this behavior. */
  @ApiProperty() observedCount!: number;
  /** Sum of the signed scores this behavior contributed. */
  @ApiProperty() totalScore!: number;
  /** A few Director rationales, as concrete evidence. */
  @ApiProperty({ type: [String] }) examples!: string[];
}

export class RoleplayCoachingDisclosureDto {
  @ApiProperty() secretId!: string;
  @ApiProperty() topic!: string;
  @ApiPropertyOptional() turnIndex?: number;
}

export class RoleplayCoachingNoteDto {
  @ApiPropertyOptional() turnIndex?: number;
  @ApiProperty() feedback!: string;
}

export class RoleplayCoachingResponseDto {
  /** False when the session is not a v2 roleplay or has no v2 telemetry yet. */
  @ApiProperty() available!: boolean;

  @ApiPropertyOptional() finalStateId?: string;
  @ApiProperty({ type: [String] }) stateJourney!: string[];
  @ApiPropertyOptional() cumulativeScore?: number;

  /** Behaviors the trainee demonstrated well (helpful, observed). */
  @ApiProperty({ type: [RoleplayCoachingBehaviorDto] })
  strengths!: RoleplayCoachingBehaviorDto[];

  /** Growth areas: unhelpful behaviors shown, or helpful behaviors never shown. */
  @ApiProperty({ type: [RoleplayCoachingBehaviorDto] })
  growthAreas!: RoleplayCoachingBehaviorDto[];

  @ApiProperty({ type: [RoleplayCoachingDisclosureDto] })
  disclosures!: RoleplayCoachingDisclosureDto[];

  @ApiProperty({ type: [RoleplayCoachingNoteDto] })
  coachingNotes!: RoleplayCoachingNoteDto[];
}
