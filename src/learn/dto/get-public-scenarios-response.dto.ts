import { ApiProperty } from '@nestjs/swagger';
import { ScenarioStatus } from '../type/scenario.type';

export class PublicScenarioResponseDto {
  @ApiProperty({
    description: 'ID of the scenario',
    type: Number,
  })
  id!: number;

  @ApiProperty({
    description: 'Title of the scenario',
    type: String,
  })
  title?: string;

  @ApiProperty({
    description: 'Scenario of the scenario',
    type: String,
  })
  scenario?: string;

  @ApiProperty({
    description: 'Description of the scenario',
    type: String,
  })
  description?: string;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    type: String,
  })
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Cover video URL of the scenario',
    type: String,
  })
  coverVideoUrl?: string;

  @ApiProperty({
    description: 'Status of the scenario',
    enum: ScenarioStatus,
  })
  status!: ScenarioStatus;
}

export class GetPublicScenariosResponseDto {
  @ApiProperty({
    description: 'List of scenarios',
    type: [PublicScenarioResponseDto],
  })
  data!: PublicScenarioResponseDto[];

  @ApiProperty({
    description: 'Total number of scenarios',
    type: Number,
  })
  count!: number;
}
