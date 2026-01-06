import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProfileImageUploadContentType } from '../enum/user.enum';

export class ProfileImageUploadRequestDto {
  @ApiProperty({
    description: 'Name of the image file',
    example: 'profile-pic.jpg',
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
    example: ProfileImageUploadContentType.JPEG,
    enum: ProfileImageUploadContentType,
  })
  @IsEnum(ProfileImageUploadContentType)
  @IsNotEmpty()
  contentType!: ProfileImageUploadContentType;
}

export class ProfileImageUploadResponseDto {
  @ApiProperty({
    description: 'Presigned URL for uploading the profile image',
  })
  presignedUrl!: string;

  @ApiProperty({
    description: 'Public URL for accessing the profile image',
  })
  profileImageUrl!: string;
}
