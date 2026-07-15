import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Superadmin edit of an existing comfort-audio track. Both fields are optional
 * so the same endpoint can rename a track and/or toggle its archived state.
 */
export class UpdateComfortAudioTrackDto {
  @ApiProperty({
    description: 'New display name for the track',
    required: false,
    example: 'Rain ambience (soft)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    description:
      'Archive (true) or unarchive (false). Archived tracks cannot be newly selected for a roleplay but keep working for scenarios already using them.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
