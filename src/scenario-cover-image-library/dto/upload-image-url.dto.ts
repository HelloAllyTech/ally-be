import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { ScenarioCoverImageUploadContentType } from '../enum/scenario-cover-image-upload-content-type.enum';

export class UploadImageUrlRequestDto {
  @ApiProperty({
    description: 'Name of the image file',
    example: 'cover.jpg',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
    minimum: 1,
    maximum: 2048000,
  })
  @IsNumber()
  @Min(1)
  @Max(2048000)
  fileSize!: number;

  @ApiProperty({
    description: 'MIME type of the image file',
    example: ScenarioCoverImageUploadContentType.JPEG,
    enum: ScenarioCoverImageUploadContentType,
  })
  @IsEnum(ScenarioCoverImageUploadContentType)
  @IsNotEmpty()
  contentType!: ScenarioCoverImageUploadContentType;
}

export class UploadImageUrlResponseDto {
  @ApiProperty({ description: 'Presigned URL for uploading the image' })
  presignedUrl!: string;

  @ApiProperty({ description: 'S3 object URL for the uploaded image' })
  imageUrl!: string;
}
