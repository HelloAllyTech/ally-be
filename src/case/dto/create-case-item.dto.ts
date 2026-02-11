import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  Min,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class CreateCaseItemDto {
  @ApiProperty({
    description: 'ID of the scenario to include in the case',
    example: 101,
  })
  @IsNumber()
  @IsNotEmpty()
  scenarioId!: number;

  @ApiProperty({
    description: 'Minimum score required to unlock this scenario',
    example: 75,
  })
  @IsNotEmpty()
  @IsNumber()
  minimumScore!: number;

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
      'Order/position of this case item in the case (starting from 1)',
    example: 1,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  order!: number;
}

export class CreateCaseSessionResponseDto {
  @ApiProperty({
    description: 'ID of the first case session item',
    example: '123',
  })
  @IsString()
  @IsNotEmpty()
  caseSessionItemId!: string;
}
