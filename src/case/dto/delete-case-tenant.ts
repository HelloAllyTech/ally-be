import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class DeleteCaseTenantDto {
  @ApiProperty({
    description: 'Array of case IDs (UUIDs) to remove from the tenant',
    example: [
      'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      'b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e',
    ],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one case ID is required' })
  @IsUUID('4', {
    each: true,
    message: 'Each case ID must be a valid UUID',
  })
  caseIds!: string[];
}
