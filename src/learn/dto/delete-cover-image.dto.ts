import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteCoverImageDto {
  @ApiProperty({
    description: 'S3 URL of the cover image to delete',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/scenario-cover-images/1730000000000-image.jpg',
  })
  @IsString()
  @IsNotEmpty()
  coverImageUrl!: string;
}
