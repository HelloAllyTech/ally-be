import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class PreviewScenarioDto {
  @ApiProperty({
    description: 'Scenario ID',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;
}
