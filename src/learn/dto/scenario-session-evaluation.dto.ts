import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Webhook payload from ai-learn carrying the goal-based actor evaluation of a
 * real session. Mirrors the scenario-report webhook shape (metrics map +
 * markdown + status), but for a real `scenario_session`.
 */
export class UpdateActorEvaluationDto {
  @ApiProperty({
    description: 'COMPLETED | FAILED',
    example: 'COMPLETED',
  })
  @IsString()
  status!: string;

  @ApiProperty({
    required: false,
    description: 'Goal/metric name -> 0-100 score',
    example: { 'Build rapport with the user': 82, 'Stay in character': 90 },
  })
  @IsOptional()
  @IsObject()
  metrics?: Record<string, number>;

  @ApiProperty({
    required: false,
    description: 'Human-readable judge feedback',
  })
  @IsOptional()
  @IsString()
  report_markdown?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  error_message?: string;
}
