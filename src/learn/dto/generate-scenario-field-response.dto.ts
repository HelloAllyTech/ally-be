import { ApiProperty } from '@nestjs/swagger';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorResponseDto } from './behavior-response.dto';

export class StateInstructionItem {
  @ApiProperty({ description: 'State identifier (1-4)' })
  stateId!: string;

  @ApiProperty({ description: 'Name of the state', required: false })
  name?: string;

  @ApiProperty({ description: 'Behavioral directive for the state' })
  instruction!: string;

  @ApiProperty({
    description: 'Sample dialogue lines for the state',
    type: [String],
  })
  dialogues!: string[];
}

export class BehaviorInstructionStateItem {
  @ApiProperty({ description: 'State identifier (1-4)' })
  stateId!: string;

  @ApiProperty({
    description:
      'How the simulated client should react in this phase when the linked helper behaviors are observed',
  })
  instruction!: string;
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

  @ApiProperty({
    description:
      'Per-phase (states 1-4) guidance for the actor; must align with scenario flow',
    type: [BehaviorInstructionStateItem],
  })
  stateInstructions!: BehaviorInstructionStateItem[];
}

export class SimulationStateAutofillItem {
  @ApiProperty({ description: 'Human-readable state name.' })
  name!: string;

  @ApiProperty({
    description: 'Free-text guidance injected when this state is active.',
  })
  guidelines!: string;

  @ApiProperty({
    description:
      'Inclusive lower bound on current_score; null = open (first state).',
    nullable: true,
  })
  scoreLower!: number | null;

  @ApiProperty({
    description:
      'Exclusive upper bound on current_score; null = open (last state).',
    nullable: true,
  })
  scoreUpper!: number | null;

  @ApiProperty({
    description:
      'When false, the retrieval step is skipped while this state is active.',
  })
  ragEnabled!: boolean;
}

export class KnowledgeSourceAutofillItem {
  @ApiProperty({ description: 'Short title/topic label (1-4 words).' })
  title!: string;

  @ApiProperty({
    description:
      'Self-contained narrative content the agent can reference when this ' +
      'topic is relevant. Written in second person ("You ...") to match ' +
      'the actor voice.',
  })
  content!: string;
}

export class GenerateScenarioFieldResponseDto {
  @ApiProperty({
    description: 'The field that was generated',
    enum: GeneratableField,
  })
  fieldName!: GeneratableField;

  @ApiProperty({
    description:
      'Generated content. String for characterProfileText/description, string[] for openingStatements or linguisticStyleSamples/allowedFillerWords, StateInstructionItem[] for stateInstructions, BehaviorInstructionItem[] for behaviorInstructions (each item includes stateInstructions for phases 1–4). (legacy/simpler), or an object { instructions, stateNames } for behaviorInstructions.',
  })
  content!:
    | string
    | string[]
    | StateInstructionItem[]
    | BehaviorInstructionItem[]
    | any;
}
