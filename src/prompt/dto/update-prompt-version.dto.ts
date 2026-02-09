import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePromptVersionDto {
  @ApiProperty({ description: 'Prompt version content', required: false })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiProperty({
    description: 'User ID updating this version',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  updatedBy?: number;
}
