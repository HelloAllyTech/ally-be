import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  Min,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class UpdateScenarioPathItemDto {
  @ApiProperty({
    description: 'ID of the scenario to include in the path',
    example: 101,
  })
  @IsNumber()
  @IsNotEmpty()
  scenarioId!: number;

  @ApiPropertyOptional({
    description:
      'Minimum score required to unlock this scenario. Omit for no requirement.',
    example: 75,
  })
  @IsOptional()
  @IsNumber()
  minimumScore?: number;

  @ApiPropertyOptional({
    description:
      'Title of the message to display when this scenario is completed',
    example: 'Scenario Completed',
  })
  @IsOptional()
  @IsString()
  messageTitle?: string;

  @ApiPropertyOptional({
    description:
      'Content of the message to display when this scenario is completed',
    example: 'Great job! You can now proceed to the next scenario.',
  })
  @IsOptional()
  @IsString()
  messageContent?: string;

  @ApiProperty({
    description:
      'Order/position of this scenario in the path (starting from 1)',
    example: 1,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  order!: number;
}
