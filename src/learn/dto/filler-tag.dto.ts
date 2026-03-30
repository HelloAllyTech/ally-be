import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateFillerTagDto {
  @ApiProperty({ description: 'Filler word or short phrase', example: 'um' })
  @IsNotEmpty()
  @IsString()
  name!: string;
}

export class FillerTagResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class GetFillerTagsResponseDto {
  @ApiProperty({ type: [FillerTagResponseDto] })
  data!: FillerTagResponseDto[];

  @ApiProperty()
  count!: number;
}

export class CreateFillerTagResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false })
  createdBy?: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
