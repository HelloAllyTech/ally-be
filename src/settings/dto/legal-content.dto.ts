import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateLegalContentDto {
  @ApiProperty({
    description: 'Sanitized HTML content for the legal page',
  })
  @IsString()
  html!: string;
}
