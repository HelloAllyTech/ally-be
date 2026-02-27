import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class AddScenarioCoverImageDto {
  @ApiProperty({
    description:
      'Image URL - S3 URL (from presigned upload) or any public image asset URL',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/scenario-cover-image-library/1730000000000-cover.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'] })
  imageUrl!: string;
}
