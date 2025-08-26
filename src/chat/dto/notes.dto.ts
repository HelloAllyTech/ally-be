import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNoteDto {
  @ApiProperty({ description: 'Note content' })
  @IsString()
  content!: string;
}
