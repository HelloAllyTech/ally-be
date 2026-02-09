import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class StateInstructionsDto {
  @ApiProperty({
    description: 'State ID',
    example: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  stateId!: number;

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
