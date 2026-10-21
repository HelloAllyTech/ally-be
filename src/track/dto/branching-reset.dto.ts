import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class BranchingResetDto {
  @ApiProperty({ description: 'The learner whose attempts to reopen' })
  @IsInt()
  @Min(1)
  userId!: number;
}
