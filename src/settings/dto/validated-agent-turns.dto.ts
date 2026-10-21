import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ValidatedAgentTurnsDto {
  @ApiProperty({
    description:
      'Course Copilot ends each turn with a reply checked against what the turn did. Off runs its previous loop.',
  })
  courseCopilot!: boolean;

  @ApiProperty({
    description:
      'The character interview ends each turn with a reply checked against what the turn did. Off runs its previous loop.',
  })
  characterInterview!: boolean;
}

/** Either switch left out keeps its current value. */
export class UpdateValidatedAgentTurnsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  courseCopilot?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  characterInterview?: boolean;
}
