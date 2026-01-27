import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class ToggleCommentVisibilityDto {
  @ApiProperty({ example: true, description: 'Hide/unhide the comment' })
  @IsNotEmpty()
  @IsBoolean()
  hidden!: boolean;
}
