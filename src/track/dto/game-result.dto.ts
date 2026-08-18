import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The upper bound is a sanity rail, not a rule: nothing depends on this number
 * being true, but a personal best of 10^9 reads as broken rather than
 * impressive.
 */
export class GameResultDto {
  @ApiProperty({ description: 'Score for the run that just ended' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  score!: number;
}
