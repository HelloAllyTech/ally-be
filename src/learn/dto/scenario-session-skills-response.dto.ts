import { ApiProperty } from '@nestjs/swagger';

export class ScenarioSessionSkillCoverageItemDto {
  @ApiProperty({
    description: 'Skill category',
    enum: ['Learning', 'Support', 'Standards'],
  })
  category!: string;

  @ApiProperty({ description: 'Coverage percentage (0-100)' })
  percentage!: number;
}

export class ScenarioSessionEmotionalMovementItemDto {
  @ApiProperty({ description: 'Message id' })
  messageId!: string;

  @ApiProperty({ description: 'Emotional level' })
  level!: number;

  @ApiProperty({ description: 'Start time in seconds', required: false })
  startTime?: number;
}

export class ScenarioSessionSkillsResponseDto {
  @ApiProperty({
    type: [ScenarioSessionSkillCoverageItemDto],
    description: 'Skill coverage from scenario session evaluation',
  })
  skillCoverage!: ScenarioSessionSkillCoverageItemDto[];

  @ApiProperty({
    type: [ScenarioSessionEmotionalMovementItemDto],
    description: 'Emotional movement data from scenario session evaluation',
  })
  emotionalMovement!: ScenarioSessionEmotionalMovementItemDto[];
}
