import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOptimisationGoalDto {
  @ApiProperty({
    description: 'Title of the optimisation goal',
    example: 'Build rapport with the user',
  })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiProperty({
    description: 'Category the goal belongs to',
    example: 'Relationship',
  })
  @IsNotEmpty()
  @IsString()
  category!: string;

  @ApiProperty({
    description: 'Free-text description of the goal',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateOptimisationGoalDto {
  @ApiProperty({
    description: 'Title of the optimisation goal',
    required: false,
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'Category the goal belongs to', required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'Free-text description of the goal',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class OptimisationGoalResponseDto {
  @ApiProperty({ description: 'ID of the optimisation goal' })
  id!: string;

  @ApiProperty({ description: 'Title of the optimisation goal' })
  title!: string;

  @ApiProperty({ description: 'Category the goal belongs to' })
  category!: string;

  @ApiProperty({
    description: 'Free-text description of the goal',
    required: false,
  })
  description?: string;
}

export class GetOptimisationGoalsResponseDto {
  @ApiProperty({
    type: [OptimisationGoalResponseDto],
    description: 'List of optimisation goals',
  })
  data!: OptimisationGoalResponseDto[];

  @ApiProperty({ description: 'Total count of optimisation goals' })
  count!: number;
}
