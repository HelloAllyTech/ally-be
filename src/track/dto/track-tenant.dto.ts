import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class CreateTrackTenantDto {
  @ApiProperty({
    description: 'Array of track IDs (UUIDs) to assign to the tenant',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one track ID is required' })
  @IsUUID('4', { each: true, message: 'Each track ID must be a valid UUID' })
  trackIds!: string[];
}

export class DeleteTrackTenantDto {
  @ApiProperty({
    description: 'Array of track IDs (UUIDs) to remove from the tenant',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one track ID is required' })
  @IsUUID('4', { each: true, message: 'Each track ID must be a valid UUID' })
  trackIds!: string[];
}
