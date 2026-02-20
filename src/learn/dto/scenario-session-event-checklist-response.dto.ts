import { ApiProperty } from '@nestjs/swagger';

export class ScenarioSessionEventChecklistDto {
  @ApiProperty({
    description: 'The ID of the event in the checklist',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'The name of the event in the checklist',
    example: 'Event 1',
  })
  name!: string;

  @ApiProperty({
    description: 'Whether the event has occurred in the session',
    example: true,
  })
  hasOccurred!: boolean;
}

export class ScenarioSessionEventChecklistResponseDto {
  @ApiProperty({
    description: 'The list of events in the checklist',
    type: [ScenarioSessionEventChecklistDto],
  })
  eventChecklist!: ScenarioSessionEventChecklistDto[];
}
