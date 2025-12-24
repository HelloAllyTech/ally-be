import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ScenarioPathStatus } from '../type/scenario-paths.type';

export class DuplicateScenarioPathResponseDto {
  @ApiProperty({ description: 'ID of the scenario path' })
  id!: string;

  @ApiProperty({ description: 'Title of the scenario path' })
  title?: string;

  @ApiProperty({ description: 'Description of the scenario path' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the scenario path' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the scenario path' })
  @IsEnum(ScenarioPathStatus)
  status!: ScenarioPathStatus;
}
