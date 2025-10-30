import { ApiProperty } from '@nestjs/swagger';

export class ScenarioImageUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for uploading the image',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'Public URL for accessing the uploaded image',
  })
  coverImageUrl!: string;
}
