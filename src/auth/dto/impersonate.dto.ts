import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImpersonateDto {
  @ApiProperty({
    description: 'Email for authentication',
    example: 'john_doe@gmail.com',
  })
  @IsString()
  @IsNotEmpty()
  email!: string;
}
