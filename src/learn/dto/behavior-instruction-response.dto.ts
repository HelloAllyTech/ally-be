import { ApiProperty } from '@nestjs/swagger';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorResponseDto } from './behavior-response.dto';

export class BehaviorInstructionWithBehaviorsDto {
  @ApiProperty({
    description: 'ID of the behavior instruction',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Category of the behavior instruction',
    enum: BehaviorInstructionCategory,
    example: BehaviorInstructionCategory.SHOULD_DO,
  })
  category!: BehaviorInstructionCategory;

  @ApiProperty({
    description: 'Array of instruction strings',
    example: ['Listen actively', 'Show empathy'],
    type: [String],
  })
  instructions!: string[];

  @ApiProperty({
    description: 'Array of behaviors associated with this instruction',
    type: [BehaviorResponseDto],
  })
  behaviors!: BehaviorResponseDto[];
}
