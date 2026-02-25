import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const S3_URL_PATTERN = /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;

export class AddScenarioCoverImageDto {
  @ApiProperty({
    description: 'S3 URL of the uploaded image',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/scenario-cover-image-library/1730000000000-cover.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(S3_URL_PATTERN, {
    message: 'imageUrl must be a valid S3 URL',
  })
  imageUrl!: string;
}
