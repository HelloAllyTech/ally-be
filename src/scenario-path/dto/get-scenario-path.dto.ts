import { ApiProperty } from '@nestjs/swagger';
import { ScenarioPathStatus } from '../type/scenario-paths.type';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/enum/scenario.status.enum';

export class GetScenarioPathItemDto {
  @ApiProperty({ description: 'ID of the scenario path item' })
  id!: string;

  @ApiProperty({ description: 'ID of the scenario' })
  scenarioId!: number;

  @ApiProperty({ description: 'Order of the scenario in the path' })
  order!: number;

  @ApiProperty({ description: 'Message title of the scenario' })
  messageTitle?: string;

  @ApiProperty({ description: 'Message content of the scenario' })
  messageContent?: string;

  @ApiProperty({ description: 'Minimum score of the scenario' })
  minimumScore?: number;

  @ApiProperty({ description: 'Title of the scenario' })
  title?: string;

  @ApiProperty({ description: 'Description of the scenario' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the scenario' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Cover video URL of the scenario' })
  coverVideoUrl?: string;
}

export class GetScenarioPathResponseDto {
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

  @ApiProperty({ description: 'Whether the path is available globally' })
  isGlobal!: boolean;

  @ApiProperty({ description: 'Total scenarios in the scenario path' })
  totalScenarios!: number;

  @ApiProperty({ description: 'List of scenarios in the path' })
  scenarios!: GetScenarioPathItemDto[];
}

export class GetUpcomingScenarioPathItemResponseDto
  implements Partial<Scenarios>
{
  @ApiProperty({ description: 'ID of the scenario', required: false })
  id?: number;

  @ApiProperty({ description: 'Title of the scenario', required: false })
  title?: string;

  @ApiProperty({ description: 'Scenario content', required: false })
  scenario?: string;

  @ApiProperty({ description: 'Description of the scenario', required: false })
  description?: string;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    required: false,
  })
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Cover video URL of the scenario',
    required: false,
  })
  coverVideoUrl?: string;

  @ApiProperty({ description: 'Status of the scenario', required: false })
  status?: ScenarioStatus;

  @ApiProperty({ description: 'ID of the scenario path session item' })
  scenarioPathSessionItemId?: string;

  @ApiProperty({
    description: 'Order of the scenario in the path',
    example: 2,
    required: false,
  })
  order?: number;

  @ApiProperty({
    description: 'Transition message title from the previous scenario',
    example: 'Great job on the previous scenario!',
    required: false,
  })
  transitionMessageTitle?: string;

  @ApiProperty({
    description: 'Transition message content from the previous scenario',
    example:
      "You have successfully completed the first scenario. Now, let's move on to the next challenge.",
    required: false,
  })
  transitionMessageContent?: string;
}
