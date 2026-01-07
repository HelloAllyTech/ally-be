import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DeleteLogoDto {
  @ApiProperty({
    description: 'S3 URL of the org-logo to delete',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/org-logos/1730000000000-image.jpg',
  })
  @IsString()
  @IsNotEmpty()
  logoUrl!: string;
}
