import { ApiProperty } from '@nestjs/swagger';

export class ScenarioPathSessionResponseDto {
  @ApiProperty({ description: 'ID of the scenario path' })
  id!: string;

  @ApiProperty({ description: 'Title of the scenario path' })
  title!: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the scenario path' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Total scenarios in the scenario path' })
  totalScenarios!: number;

  @ApiProperty({ description: 'Completed scenarios in the scenario path' })
  completedScenarios?: number;
}

export class ScenarioPathSessionsResponseDto {
  @ApiProperty({ description: 'Array of scenario path sessions' })
  data!: ScenarioPathSessionResponseDto[];

  @ApiProperty({ description: 'Total count of scenario path sessions' })
  count!: number;
}
