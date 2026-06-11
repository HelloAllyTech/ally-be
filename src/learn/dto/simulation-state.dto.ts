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
 * The starting state is emergent: the runtime opens in whichever state's
 * range contains 0 (the session's opening score), clamped to the first
 * state if 0 sits below the range. There is no `isStarting` flag.
 *
 * Validation rules (enforced by `validateSimulationStates`):
 *  - Ranges are contiguous and non-overlapping.
 *  - Every state's bounds are finite numbers (strict-bounds migration).
 *  - The first state's `scoreLower` and the last state's `scoreUpper` are
 *    the open ends of the range — the runtime resolver clamps any score
 *    below the first / at-or-above the last into that state. They stay
 *    author-editable (state 0's lower may be negative); the value is just
 *    the labelled boundary. Studio shows −∞ / +∞ as placeholder hints.
 *  - For every state, `scoreUpper - scoreLower >= 50`.
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

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on `current_score`. Finite integer; may be ' +
      'negative. For the first state this is the open lower end (any lower ' +
      'score clamps into it) but it stays author-editable. `null` is only ' +
      'transient while the author is mid-edit.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  scoreLower!: number | null;

  @ApiPropertyOptional({
    description:
      'Exclusive upper bound on `current_score`. Finite integer. For the ' +
      'last state this is the open upper end (any higher score clamps into ' +
      'it) but it stays author-editable. `null` is only transient while the ' +
      'author is mid-edit.',
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
