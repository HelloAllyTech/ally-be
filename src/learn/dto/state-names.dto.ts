import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class StateNamesDto {
  @ApiProperty({
    description: 'State ID',
    example: '1',
  })
  @IsNotEmpty()
  @IsString()
  stateId!: string;

  @ApiProperty({
    description: 'Name for the state',
    example: 'name for state 1',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;
}
