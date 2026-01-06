import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { LogoUploadContentType } from '../enum/tenant.enum';

export class LogoUploadRequestDto {
  @ApiProperty({
    description: 'Name of the image file',
    example: 'org-logo-pic.jpg',
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
    example: LogoUploadContentType.JPEG,
    enum: LogoUploadContentType,
  })
  @IsEnum(LogoUploadContentType)
  @IsNotEmpty()
  contentType!: LogoUploadContentType;
}

export class OrganizationLogoUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for uploading the organization logo',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'Public URL for accessing the organization logo',
  })
  logoUrl!: string;
}
