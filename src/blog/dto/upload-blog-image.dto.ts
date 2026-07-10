import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { BLOG_IMAGE_MAX_SIZE_BYTES } from '../constants/blog.constants';
import { BlogImageUploadContentType } from '../enum/blog-image-upload-content-type.enum';

export class UploadBlogImageRequestDto {
  @ApiProperty({ description: 'Name of the image file', example: 'header.jpg' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
    minimum: 1,
    maximum: BLOG_IMAGE_MAX_SIZE_BYTES,
  })
  @IsNumber()
  @Min(1)
  @Max(BLOG_IMAGE_MAX_SIZE_BYTES)
  fileSize!: number;

  @ApiProperty({
    description: 'MIME type of the image file',
    example: BlogImageUploadContentType.JPEG,
    enum: BlogImageUploadContentType,
  })
  @IsEnum(BlogImageUploadContentType)
  @IsNotEmpty()
  contentType!: BlogImageUploadContentType;
}

export class UploadBlogImageResponseDto {
  @ApiProperty({ description: 'Presigned URL for uploading the image' })
  presignedUrl!: string;

  @ApiProperty({ description: 'S3 object URL for the uploaded image' })
  imageUrl!: string;
}
