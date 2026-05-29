import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Per-simulation state used by `hasStates` main-agent prompts. Persisted
 * on `Scenarios.metadata.states`. Forwarded to ai-learn at session start
 * so the runtime can resolve the active state per turn score.
 *
 * Validation rules (enforced by `validateSimulationStates`):
 *  - Exactly one entry has `isStarting: true`.
 *  - Ranges are contiguous and non-overlapping.
 *  - The first state's `scoreLower` is null (open lower bound).
 *  - The last state's `scoreUpper` is null (open upper bound).
 *  - When both bounds are finite, `scoreUpper - scoreLower >= 50`.
 */
export class SimulationStateDto {
  @ApiProperty({ description: 'Stable id for this state across saves.' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ description: 'Human-readable state name shown in studio.' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description:
      'Free-text guidance injected into the prompt when this state is ' +
      'active. Substituted into `{state_x_guidelines}` at runtime.',
  })
  @IsString()
  guidelines!: string;

  @ApiProperty({
    description:
      'Exactly one state in the array must be marked starting. Used on ' +
      'turn 1 before any score has accumulated.',
  })
  @IsBoolean()
  isStarting!: boolean;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on `current_score`. `null` means open at ' +
      'this end (must be the first state).',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  scoreLower!: number | null;

  @ApiPropertyOptional({
    description:
      'Exclusive upper bound on `current_score`. `null` means open at ' +
      'this end (must be the last state).',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  scoreUpper!: number | null;

  @ApiProperty({
    description:
      'When false, the knowledge-source retrieval is skipped while this ' +
      'state is active and `{retrieved_context}` is rendered empty.',
  })
  @IsBoolean()
  ragEnabled!: boolean;
}
