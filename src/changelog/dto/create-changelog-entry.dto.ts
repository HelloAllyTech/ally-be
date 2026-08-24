import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateChangelogEntryDto {
  @ApiProperty({
    description: 'Name of the repo the merged PR belongs to',
    example: 'ally-be',
  })
  @IsString()
  @IsNotEmpty()
  repo!: string;

  @ApiProperty({
    description: 'Human-readable release note text for the merged PR',
    example: 'Added public changelog feed to the helpline dashboard.',
  })
  @IsString()
  @IsNotEmpty()
  releaseNoteText!: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp the PR was merged at',
    example: '2026-08-24T12:00:00.000Z',
  })
  @IsDateString()
  mergedAt!: string;
}
