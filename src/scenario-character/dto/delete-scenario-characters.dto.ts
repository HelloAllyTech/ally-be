import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class DeleteScenarioCharactersDto {
  @ApiProperty({
    description: 'List of scenario character IDs (UUIDs) to delete',
    type: [String],
    example: [
      '367e6847-b834-4d92-b7b7-14e97afe78e2',
      '367e6847-b834-4d92-b7b7-14e97afe78e3',
    ],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one scenario character ID is required' })
  @IsUUID('4', { each: true, message: 'Each ID must be a valid UUID' })
  scenarioCharacterIds!: string[];
}
