import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReflectionPromptItemRequestDto {
  @ApiProperty({ description: 'Prompt id (UUID from constants)' })
  @IsUUID()
  promptId!: string;

  @ApiProperty({ description: 'Response text for the prompt' })
  @IsString()
  response!: string;
}

export class ReflectionPromptsRequestDto {
  @ApiProperty({
    type: [ReflectionPromptItemRequestDto],
    description: 'Reflection prompt responses to insert',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReflectionPromptItemRequestDto)
  reflectionPrompts!: ReflectionPromptItemRequestDto[];
}

export class UpdateReflectionPromptResponseDto {
  @ApiProperty({ description: 'Updated response text for the prompt' })
  @IsString()
  response!: string;
}
