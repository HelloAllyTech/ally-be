import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { TRACK_MAX_BRANCHING_PATH_LENGTH } from '../constants/track.constant';

export class BranchingResultDto {
  @ApiProperty({
    description:
      'Ids of the choices the learner made, in order, from the first scene to an ending',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRACK_MAX_BRANCHING_PATH_LENGTH)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  path!: string[];
}
