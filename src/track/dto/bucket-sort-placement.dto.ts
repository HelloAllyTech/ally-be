import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BucketSortPlacementDto {
  @ApiProperty({ description: 'Id of the item the learner placed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sortItemId!: string;

  @ApiProperty({ description: 'Id of the bucket they dropped it into' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bucketId!: string;
}
