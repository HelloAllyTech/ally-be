import { ApiProperty } from '@nestjs/swagger';

export class ScenarioCoverImageLibraryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'S3 object URL' })
  imageUrl!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
