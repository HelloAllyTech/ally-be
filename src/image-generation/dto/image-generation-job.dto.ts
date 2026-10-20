import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ImageGenerationJobStatus = 'running' | 'succeeded' | 'failed';

/** What a start returns at once and what every poll returns after. */
export class ImageGenerationJobDto {
  @ApiProperty({ description: 'Poll with this id' })
  jobId!: string;

  @ApiProperty({ enum: ['running', 'succeeded', 'failed'] })
  status!: ImageGenerationJobStatus;

  @ApiPropertyOptional({ description: 'Set once status is succeeded' })
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Set once status is failed — a sentence to show the author',
  })
  error?: string;

  @ApiProperty()
  startedAt!: string;

  @ApiPropertyOptional()
  finishedAt?: string;
}
