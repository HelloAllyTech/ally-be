import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteCoverVideoDto {
  @ApiProperty({
    description: 'S3 URL of the cover video to delete',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/scenario-cover-videos/1730000000000-video.mp4',
  })
  @IsString()
  @IsNotEmpty()
  coverVideoUrl!: string;
}
