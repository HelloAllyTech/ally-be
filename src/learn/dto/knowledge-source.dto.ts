import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class KnowledgeSourceDto {
  @ApiProperty({
    description: 'Knowledge source ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: 'Title of the knowledge source',
    example: 'Knowledge source 1',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Knowledge source content',
    example: 'Knowledge source content',
  })
  @IsString()
  @IsOptional()
  content?: string;
}
