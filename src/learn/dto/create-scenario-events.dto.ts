import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString } from 'class-validator';

export class CreateScenarioEventsDto {
  @ApiProperty({
    description: 'ID of the scenario',
    example: 1,
  })
  @IsNumber()
  scenarioId!: number;

  @ApiProperty({
    description: 'List of event IDs',
    type: [String],
    example: ['event1', 'event2', 'event3'],
  })
  @IsArray()
  @IsString({ each: true })
  eventIds!: string[];
}
