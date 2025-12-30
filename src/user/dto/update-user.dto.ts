import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({
    description: 'Username of the user',
    example: 'john_doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'User email',
    example: 'john_doe@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email' })
  email?: string;

  @ApiProperty({
    description: 'External ID of the user',
    example: 'TEL007',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (!value || value.trim() === '' ? null : value))
  externalId?: string;
}
