import { ApiProperty } from '@nestjs/swagger';

export class ScenarioVideoUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for uploading the video',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'Public URL for accessing the uploaded video',
  })
  coverVideoUrl!: string;
}
