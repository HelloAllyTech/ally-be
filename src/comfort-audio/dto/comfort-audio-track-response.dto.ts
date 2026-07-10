import { ApiProperty } from '@nestjs/swagger';

export class ComfortAudioTrackResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Display name for the track' })
  name!: string;

  @ApiProperty({ description: 'S3 object URL' })
  audioUrl!: string;

  @ApiProperty({ required: false, nullable: true })
  contentType?: string | null;

  @ApiProperty({ required: false, nullable: true })
  sizeBytes?: number | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
