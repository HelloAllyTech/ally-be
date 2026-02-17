import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

export class BehaviorInstructionDto {
  @ApiProperty({
    description: 'ID of the behavior instruction (required only for update)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    description: 'Category of the behavior instruction',
    enum: BehaviorInstructionCategory,
    example: BehaviorInstructionCategory.SHOULD_DO,
  })
  @IsEnum(BehaviorInstructionCategory)
  @IsNotEmpty()
  category!: BehaviorInstructionCategory;

  @ApiProperty({
    description: 'Array of behavior IDs',
    example: ['ce654c93-a76f-46b7-97bf-799485801c12'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(0)
  behaviors!: string[];

  @ApiProperty({
    description: 'Array of instruction strings',
    example: ['Listen actively', 'Show empathy'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  instructions!: string[];
}
