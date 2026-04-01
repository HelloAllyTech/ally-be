import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioImageUploadResponseDto {
  @ApiPropertyOptional({
    description:
      'Presigned URL for uploading the image. Empty when MOCK_SCENARIO_COVER_IMAGE_UPLOAD=true.',
  })
  presignedUrl?: string;

  @ApiProperty({
    description: 'Public URL for accessing the uploaded image',
  })
  coverImageUrl!: string;
}
