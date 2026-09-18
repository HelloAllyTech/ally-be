import { ApiProperty } from '@nestjs/swagger';

/**
 * Level state only.
 *
 * Split out from the full response and served by its own endpoint because the level
 * indicator renders in the persistent nav on every screen. Keeping it separate lets that
 * caller share one cache entry and one request rather than pulling the whole dashboard
 * payload on every route change.
 */
export class ProgressSummaryDto {
  @ApiProperty({
    description: 'Current level, 1 through the ladder maximum.',
    example: 4,
  })
  level!: number;

  @ApiProperty({
    description: 'Lifetime XP earned. Never decreases.',
    example: 640,
  })
  totalXp!: number;

  @ApiProperty({
    description: 'XP earned inside the current level.',
    example: 124,
  })
  xpIntoLevel!: number;

  @ApiProperty({
    description:
      'XP still needed for the next level. Null once the learner is at the maximum level.',
    example: 286,
    nullable: true,
  })
  xpToNextLevel!: number | null;

  @ApiProperty({
    description:
      'Cumulative XP at which the next level begins. Null at the maximum level.',
    example: 926,
    nullable: true,
  })
  nextLevelXp!: number | null;

  @ApiProperty({
    description:
      'Progress through the current level, 0 to 1. Always 1 at the maximum level, so a full ring reads as "topped out" rather than "about to advance".',
    example: 0.3,
  })
  progress!: number;

  @ApiProperty({
    description: 'Whether the learner has reached the top of the ladder.',
    example: false,
  })
  isMaxLevel!: boolean;
}

export class LevelThresholdDto {
  @ApiProperty({ description: 'Level number.', example: 3 })
  level!: number;

  @ApiProperty({
    description: 'Cumulative XP required to reach this level.',
    example: 260,
  })
  requiredXp!: number;
}

export class ProgressResponseDto extends ProgressSummaryDto {
  @ApiProperty({
    description:
      'Lifetime roleplay practice minutes, read from the same source as the certification chart and the badge ladder so the three cannot disagree.',
    example: 412,
  })
  lifetimePracticeMinutes!: number;

  @ApiProperty({
    description: 'Roleplay sessions that earned a completion award.',
    example: 37,
  })
  sessionsCompleted!: number;

  @ApiProperty({
    description: 'Track and course items completed.',
    example: 12,
  })
  trackItemsCompleted!: number;

  @ApiProperty({
    description:
      'The whole ladder, so a client can draw the road ahead without hardcoding thresholds that would drift from the server.',
    type: [LevelThresholdDto],
  })
  ladder!: LevelThresholdDto[];

  @ApiProperty({
    description:
      'When the learner last advanced a level, for a one-time celebration. Null if they have never left level 1.',
    nullable: true,
  })
  lastLevelUpAt!: Date | null;
}
