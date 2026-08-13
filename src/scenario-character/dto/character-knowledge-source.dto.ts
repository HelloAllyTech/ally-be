import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CharacterKnowledgeSourceDto {
  @ApiProperty({
    description: 'Knowledge source ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: 'Title of the knowledge source',
    example: 'Family background',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    description: 'Knowledge source content',
    example: 'Mariamma has three children, all of whom live in the city.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(2500)
  text?: string;
}
