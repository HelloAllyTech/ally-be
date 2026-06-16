import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateLegalContentDto {
  @ApiProperty({
    description: 'Sanitized HTML content for the legal/consent document',
  })
  @IsString()
  @MaxLength(100000)
  html!: string;
}

export class LegalContentResponseDto {
  @ApiProperty({ description: 'Sanitized HTML content (empty string if unset)' })
  html!: string;
}
