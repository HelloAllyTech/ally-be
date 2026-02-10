import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePromptVersionDto {
  @ApiProperty({ description: 'Prompt ID' })
  @IsString()
  promptId!: string;

  @ApiProperty({ description: 'Prompt version content' })
  @IsString()
  prompt!: string;

  @ApiProperty({
    description: 'User ID creating this version',
  })
  @IsOptional()
  @IsNumber()
  createdBy?: number;
}
