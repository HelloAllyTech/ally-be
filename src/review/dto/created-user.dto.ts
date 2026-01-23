import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class CreatedByDto {
  @ApiProperty()
  @IsNumber()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false, nullable: true })
  profileImage?: string | null;
}
