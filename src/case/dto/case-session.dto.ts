import { ApiProperty } from '@nestjs/swagger';

export class CaseSessionResponseDto {
  @ApiProperty({ description: 'ID of the case session' })
  id!: string;

  @ApiProperty({ description: 'Title of the case session' })
  title!: string;

  @ApiProperty({ description: 'Description of the case session' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the case session' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Total scenarios in the case session' })
  totalScenarios!: number;

  @ApiProperty({ description: 'Completed scenarios in the case session' })
  completedScenarios?: number;
}

export class CaseSessionsResponseDto {
  @ApiProperty({ description: 'Array of case sessions' })
  data!: CaseSessionResponseDto[];

  @ApiProperty({ description: 'Total count of case sessions' })
  count!: number;
}
