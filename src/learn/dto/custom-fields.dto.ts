import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CustomFieldsDto {
  @ApiProperty({
    description: 'Name of the custom field',
    example: 'Detailed instructions for the AI client persona',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Value of the custom field',
    example: 'Act as a patient and help the user for training',
  })
  @IsString()
  value!: string;
}
