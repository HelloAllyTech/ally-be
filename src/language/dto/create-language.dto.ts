import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class CreateLanguageDto {
  @ApiProperty({
    description: 'Value of the Language en-IN',
    example: 'en-IN',
  })
  @IsString()
  @IsNotEmpty()
  value!: string;

  @ApiProperty({
    description: 'Label of the Language',
    example: 'English (India)',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Active status of the language',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  active!: boolean;

  @ApiProperty({
    description: 'Google Translation Code for the language',
    example: 'hi',
  })
  @IsString()
  @IsNotEmpty()
  translationCode!: string;
}
