import { ApiProperty } from '@nestjs/swagger';

export class ChangelogEntryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  releaseNoteText!: string;

  @ApiProperty()
  mergedAt!: Date;
}

export class GetPublicChangelogEntriesResponseDto {
  @ApiProperty({ type: [ChangelogEntryResponseDto] })
  entries!: ChangelogEntryResponseDto[];

  @ApiProperty({ description: 'Total count of changelog entries' })
  count!: number;
}
