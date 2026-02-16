import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateConversationalGuardrailDto {
  @ApiPropertyOptional({
    description: 'Name of the guardrail',
    example: 'Rude Behavior',
  })
  @IsOptional()
  @IsString()
  name?: string;
  @ApiPropertyOptional({
    description: 'Classification of helper dialogue',
    example: 'rude',
  })
  @IsOptional()
  @IsString()
  helperDialogue?: string;

  @ApiPropertyOptional({
    description: 'Actor response prompt',
    example: 'why are you talking to me like that?',
  })
  @IsOptional()
  @IsString()
  actorDialogue?: string;

  @ApiPropertyOptional({
    description: 'Whether the guardrail is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
