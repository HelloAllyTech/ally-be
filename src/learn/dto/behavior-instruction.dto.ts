import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { supportedStateInstructionStateIds } from '../constants/scenario-state-instructions.constants';

class BehaviorStateInstructionDto {
  @ApiProperty({
    description: 'State ID (simulation phase)',
    enum: supportedStateInstructionStateIds,
    example: '1',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(supportedStateInstructionStateIds)
  stateId!: string;

  @ApiProperty({
    description: 'State Instruction',
    example: 'Express mild doubt about if talking is helping',
  })
  @IsOptional()
  @IsString()
  instruction?: string;
}

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
  @IsOptional()
  behaviors?: string[];

  // FEATURE_CLEANUP(FEATURE_SCENARIO_BEHAVIOR_STATE_INSTRUCTIONS): Remove instructions field
  @ApiProperty({
    description: 'Array of instruction strings',
    example: ['Listen actively', 'Show empathy'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  instructions?: string[];

  @ApiProperty({
    description: 'State instructions',
    type: [BehaviorStateInstructionDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BehaviorStateInstructionDto)
  stateInstructions?: BehaviorStateInstructionDto[];
}
