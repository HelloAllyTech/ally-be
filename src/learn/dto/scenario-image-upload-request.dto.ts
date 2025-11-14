import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ScenarioImageUploadContentType } from '../enum/scenario-image-upload-content-type.enum';

export class ScenarioImageUploadRequestDto {
  @ApiProperty({
    description: 'Name of the image file',
    example: 'scenario-cover.jpg',
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
    example: ScenarioImageUploadContentType.JPEG,
    enum: ScenarioImageUploadContentType,
  })
  @IsEnum(ScenarioImageUploadContentType)
  @IsNotEmpty()
  contentType!: ScenarioImageUploadContentType;
}
