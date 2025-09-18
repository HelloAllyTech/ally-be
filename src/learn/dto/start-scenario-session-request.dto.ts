import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class StartScenarioSessionRequestDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;
}
