import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateScenarioDto } from './create-scenario.dto';

export class CreateScenariosDto {
  @ApiProperty({
    description: 'Array of scenarios to create',
    type: [CreateScenarioDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScenarioDto)
  scenarios!: CreateScenarioDto[];
}
