import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class StateInstructionsDto {
  @ApiProperty({
    description: 'State ID',
    example: '1',
  })
  @IsNotEmpty()
  @IsString()
  stateId!: string;

  @ApiProperty({
    description: 'State Instruction',
    example: 'Express mild doubt about if talking is helping',
  })
  @IsNotEmpty()
  @IsString()
  instruction!: string;

  @ApiProperty({
    description: 'State dialogues',
    example: [
      'I highly doubt if this is helping',
      'I think we should stop talking',
    ],
  })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  dialogues!: string[];
}
