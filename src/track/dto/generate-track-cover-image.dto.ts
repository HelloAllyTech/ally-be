import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TrimStringTransform } from 'src/common/util/string-transform.util';
import {
  TRACK_COVER_PROMPT_MAX_LENGTH,
  TRACK_COVER_PROMPT_MIN_LENGTH,
} from '../constants/track.constant';

/**
 * Stateless: works for a course that has not been saved yet. The prompt goes
 * to the image provider exactly as the trainer left it — the editor's default
 * prompt already carries the style and safety rules, and nothing is appended
 * on the server.
 */
export class GenerateTrackCoverImageRequestDto {
  @ApiProperty({
    description: 'The image prompt, as edited by the trainer',
    minLength: TRACK_COVER_PROMPT_MIN_LENGTH,
    maxLength: TRACK_COVER_PROMPT_MAX_LENGTH,
  })
  @Transform(TrimStringTransform)
  @IsString()
  @IsNotEmpty()
  @MinLength(TRACK_COVER_PROMPT_MIN_LENGTH)
  @MaxLength(TRACK_COVER_PROMPT_MAX_LENGTH)
  prompt!: string;

  @ApiPropertyOptional({
    description:
      'Course title — names the stored file and tags the usage row only',
  })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(300)
  trackTitle?: string;
}
