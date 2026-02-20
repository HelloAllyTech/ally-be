import { ApiProperty } from '@nestjs/swagger';
import { GeneratableField } from '../enum/generatable-field.enum';

export class StateInstructionContent {
  @ApiProperty({ description: 'Behavioral directive for the state' })
  instruction!: string;

  @ApiProperty({
    description: 'Sample dialogue lines for the state',
    type: [String],
  })
  dialogues!: string[];
}

export class StateInstructionsContent {
  @ApiProperty({ type: StateInstructionContent })
  state_1!: StateInstructionContent;

  @ApiProperty({ type: StateInstructionContent })
  state_2!: StateInstructionContent;

  @ApiProperty({ type: StateInstructionContent })
  state_3!: StateInstructionContent;

  @ApiProperty({ type: StateInstructionContent })
  state_4!: StateInstructionContent;
}

export class GenerateScenarioFieldResponseDto {
  @ApiProperty({
    description: 'The field that was generated',
    enum: GeneratableField,
  })
  fieldName!: GeneratableField;

  @ApiProperty({
    description:
      'Generated content. String for characterProfileText/description, string[] for openingStatements, StateInstructionsContent object for stateInstructions.',
  })
  content!: string | string[] | StateInstructionsContent;
}
