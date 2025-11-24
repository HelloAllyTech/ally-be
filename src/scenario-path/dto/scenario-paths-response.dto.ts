import { ApiProperty } from '@nestjs/swagger';
import { ScenarioPath } from '../entity/scenario-path.entity';
import { ScenarioPathStatus } from '../type/scenario-paths.type';

export class ScenarioPathResponseDto {
  @ApiProperty({ description: 'ID of the scenario path' })
  id!: string;

  @ApiProperty({ description: 'Title of the scenario path' })
  title?: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the scenario path' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the scenario path' })
  status!: ScenarioPathStatus;

  @ApiProperty({ description: 'Check if scenario path is global' })
  isGlobal!: boolean;

  @ApiProperty({ description: 'Total scenarios in the scenario path' })
  totalScenarios!: number;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Check if scenario path is assigned to a tenant',
  })
  isAssignedToTenant?: boolean;
}

export class GetScenarioPathsResponseDto {
  @ApiProperty({
    type: [ScenarioPath],
    description: 'Array of scenario paths',
  })
  data!: ScenarioPathResponseDto[];

  @ApiProperty({ type: Number, description: 'Total count of scenario paths' })
  count!: number;
}
