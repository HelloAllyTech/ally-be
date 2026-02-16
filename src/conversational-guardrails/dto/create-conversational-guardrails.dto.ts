import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConversationalGuardrailDto {
  @ApiProperty({
    description: 'Name of the guardrail',
    example: 'Rude Behavior',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;
  @ApiProperty({
    description: 'Classification of helper dialogue',
    example: 'rude',
  })
  @IsNotEmpty()
  @IsString()
  helperDialogue!: string;

  @ApiProperty({
    description: 'Actor response prompt',
    example: 'why are you talking to me like that?',
  })
  @IsNotEmpty()
  @IsString()
  actorDialogue!: string;

  @ApiPropertyOptional({
    description: 'Whether the guardrail is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
