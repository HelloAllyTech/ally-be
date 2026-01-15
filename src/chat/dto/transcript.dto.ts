import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranscriptRequestDto {
  @ApiProperty({
    description: 'Chat ID',
  })
  @IsNumber()
  @IsNotEmpty()
  chatId!: number;

  @ApiProperty({
    required: false,
    description: 'S3 download URL',
    example:
      'https://dummy-bucket.s3.amazonaws.com/result.json?X-Amz-Agnature=dummy',
  })
  @IsOptional()
  @IsString()
  downloadPresignedUrl?: string;

  @ApiProperty({
    required: false,
    description: 'S3 delete object URL',
    example:
      'https://dummy-bucket.s3.amazonaws.com/result.json?X-Amz-Agnature=dummy',
  })
  @IsOptional()
  @IsString()
  deletePresignedUrl?: string;

  @ApiProperty({
    required: false,
    description: 'Error occurred during chat transcript/summary generation',
    example: 'Internal server error',
  })
  @IsOptional()
  @IsString()
  error?: string;
}
