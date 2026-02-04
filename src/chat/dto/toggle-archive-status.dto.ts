import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class ToggleArchiveStatusDto {
  @ApiProperty({
    description: 'Archive status of the call log',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  archive!: boolean;
}
