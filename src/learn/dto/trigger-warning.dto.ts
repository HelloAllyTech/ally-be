import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTriggerWarningDto {
  @ApiProperty({
    description: 'Name of the trigger warning',
    example: 'Domestic abuse',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;
}
