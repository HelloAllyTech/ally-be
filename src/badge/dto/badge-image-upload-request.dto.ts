import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BadgeImageUploadContentType } from '../enum/badge-image-upload-content-type.enum';

export class BadgeImageUploadRequestDto {
  @ApiProperty({
    description: 'Name of the image file',
    example: 'badge-image.png',
  })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
    minimum: 1,
    maximum: 2048000, // 2 MB
  })
  @IsNumber()
  @Min(1)
  @Max(2048000) // 5MB
  fileSize!: number;

  @ApiProperty({
    description: 'MIME type of the image file',
    example: BadgeImageUploadContentType.PNG,
    enum: BadgeImageUploadContentType,
  })
  @IsEnum(BadgeImageUploadContentType)
  @IsNotEmpty()
  contentType!: BadgeImageUploadContentType;
}
