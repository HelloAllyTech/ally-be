import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteBadgeImageDto {
  @ApiProperty({
    description: 'S3 URL of the badge image to delete',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/badge-images/1730000000000-image.png',
  })
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;
}
