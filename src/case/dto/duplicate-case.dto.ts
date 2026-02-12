import { ApiProperty } from '@nestjs/swagger';

import { CaseStatus } from '../type/cases.type';
import { IsEnum } from 'class-validator';

export class DuplicateCaseResponseDto {
  @ApiProperty({ description: 'ID of the case' })
  id!: string;

  @ApiProperty({ description: 'Title of the case' })
  title?: string;

  @ApiProperty({ description: 'Description of the case' })
  description?: string;

  @ApiProperty({ description: 'Cover image URL of the case' })
  coverImageUrl?: string;

  @ApiProperty({ description: 'Status of the case' })
  @IsEnum(CaseStatus)
  status!: CaseStatus;
}
