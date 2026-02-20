import { ApiProperty } from '@nestjs/swagger';
import { GeneratableField } from '../enum/generatable-field.enum';

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

export class GenerateScenarioFieldResponseDto {
  @ApiProperty({
    description: 'The field that was generated',
    enum: GeneratableField,
  })
  fieldName!: GeneratableField;

  @ApiProperty({
    description:
      'Generated content. String for characterProfileText/description, string[] for openingStatements, StateInstructionItem[] for stateInstructions.',
  })
  content!: string | string[] | StateInstructionItem[];
}
