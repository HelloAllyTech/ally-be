import { ApiProperty } from '@nestjs/swagger';
import { CaseStatus } from '../type/cases.type';
import { Case } from '../entity/case.entity';
export class CaseResponseDto {
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

  @ApiProperty({ description: 'Check if case is global' })
  isGlobal!: boolean;

  @ApiProperty({ description: 'Total scenarios in the case' })
  totalScenarios!: number;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Check if case is assigned to a tenant',
  })
  isAssignedToTenant?: boolean;
}
export class GetCaseResponseDto {
  @ApiProperty({
    type: [Case],
    description: 'Array of scenario paths',
  })
  data!: CaseResponseDto[];

  @ApiProperty({ type: Number, description: 'Total count of cases' })
  count!: number;
}
