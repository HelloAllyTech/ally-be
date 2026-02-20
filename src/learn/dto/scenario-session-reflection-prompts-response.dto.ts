import { ApiProperty } from '@nestjs/swagger';

export class ReflectionPromptItemDto {
  @ApiProperty({
    description: 'Id of the response row or prompt id when no response saved',
  })
  id!: string;

  @ApiProperty({ description: 'Prompt id (UUID from constants)' })
  promptId!: string;

  @ApiProperty({ description: 'The reflection prompt text' })
  prompt!: string;

  @ApiProperty({
    description: 'User response to the prompt (optional when not yet answered)',
    required: false,
  })
  response?: string;
}

export class ScenarioSessionReflectionPromptsResponseDto {
  @ApiProperty({
    type: [ReflectionPromptItemDto],
    description: 'Reflection prompts with optional saved responses',
  })
  reflectionPrompts!: ReflectionPromptItemDto[];
}
