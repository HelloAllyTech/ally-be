import { ApiProperty } from '@nestjs/swagger';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorResponseDto } from './behavior-response.dto';

export class StateInstructionItem {
  @ApiProperty({ description: 'State identifier (1-4)' })
  stateId!: string;

  @ApiProperty({ description: 'Behavioral directive for the state' })
  instruction!: string;

  @ApiProperty({
    description: 'Sample dialogue lines for the state',
    type: [String],
  })
  dialogues!: string[];
}

export class BehaviorInstructionItem {
  @ApiProperty({
    description: 'Category of the behavior instruction',
    enum: BehaviorInstructionCategory,
    example: BehaviorInstructionCategory.SHOULD_DO,
  })
  category!: BehaviorInstructionCategory;

  @ApiProperty({
    description: 'Array of instruction strings (actor responses)',
    example: ['I feel heard and understood right now.'],
    type: [String],
  })
  instructions!: string[];

  @ApiProperty({
    description: 'Array of behaviors associated with this instruction',
    type: [BehaviorResponseDto],
  })
  behaviors!: BehaviorResponseDto[];
}

export class GenerateScenarioFieldResponseDto {
  @ApiProperty({
    description: 'The field that was generated',
    enum: GeneratableField,
  })
  fieldName!: GeneratableField;

  @ApiProperty({
    description:
      'Generated content. String for characterProfileText/description, string[] for openingStatements, StateInstructionItem[] for stateInstructions, BehaviorInstructionItem[] for behaviorInstructions.',
  })
  content!:
    | string
    | string[]
    | StateInstructionItem[]
    | BehaviorInstructionItem[];
}
