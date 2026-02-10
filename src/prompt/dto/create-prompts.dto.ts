import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateSinglePromptDto } from './create-prompt.dto';
import { Type } from 'class-transformer';

export class CreatePromptsDto {
  @ApiProperty({
    description: 'Array of prompts to create',
    type: [CreateSinglePromptDto],
    example: [
      {
        promptCode: 'customer_service',
        name: 'Customer Service Prompt',
        description: 'Prompt for handling customer inquiries',
        prompt: 'You are a helpful customer service representative...',
      },
      {
        promptCode: 'technical_support',
        name: 'Technical Support Prompt',
        description: 'Prompt for handling technical issues',
        prompt: 'You are a technical support specialist...',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSinglePromptDto)
  prompts!: CreateSinglePromptDto[];
}
