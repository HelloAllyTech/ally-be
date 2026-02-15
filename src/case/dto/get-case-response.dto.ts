import { ApiProperty } from '@nestjs/swagger';
import { CaseStatus } from '../type/cases.type';

export class GetCaseItemDto {
  @ApiProperty({ description: 'ID of the case item' })
  id!: string;

  @ApiProperty({ description: 'ID of the scenario' })
  scenarioId!: number;

  @ApiProperty({ description: 'Order of the scenario in the case' })
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

export class GetCaseItemResponseDto {
  @ApiProperty({ description: 'ID of the case' })
  id!: string;

  @ApiProperty({ description: 'Title of the case' })
  title?: string;

  @ApiProperty({ description: 'Description of the case' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the case' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the case' })
  status!: CaseStatus;

  @ApiProperty({ description: 'Whether the case is available globally' })
  isGlobal!: boolean;

  @ApiProperty({ description: 'Total scenarios in the case' })
  totalScenarios!: number;

  @ApiProperty({ description: 'List of scenarios in the case' })
  scenarios!: GetCaseItemDto[];
}
