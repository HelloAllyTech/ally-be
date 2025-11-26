import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class DeleteScenarioTenantDto {
  @ApiProperty({
    description: 'Array of scenarios to remove from the tenant',
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one scenario ID is required' })
  @IsNumber({}, { each: true, message: 'Each scenario ID must be a number' })
  @Type(() => Number)
  scenarioIds!: number[];
}
