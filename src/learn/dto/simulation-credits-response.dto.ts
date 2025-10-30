import { ApiProperty } from '@nestjs/swagger';

export class SimulationCreditsResponseDto {
  @ApiProperty({
    description: 'Number of total credits',
    example: 100,
  })
  creditLimit!: number;

  @ApiProperty({
    description: 'Number of consumed credits',
    example: 75,
  })
  consumedCredits!: number;

  @ApiProperty({
    description: 'Duration allowed per credit',
    example: 60,
  })
  secondsAllowedPerCredit!: number;
}
