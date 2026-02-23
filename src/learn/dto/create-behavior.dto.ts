import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class CreateBehaviorDto {
  @ApiProperty({
    description: 'Name of the behavior',
    example: 'Active Listening',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;
}

export class CreateBehaviorsDto {
  @ApiProperty({
    description: 'List of behaviors to create',
    example: [{ name: 'Active Listening' }, { name: 'Active Listening' }],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBehaviorDto)
  behaviors!: CreateBehaviorDto[];
}

export class CreateBehaviorResponseDto {
  @ApiProperty({ description: 'ID of the created behavior' })
  id!: string;

  @ApiProperty({ description: 'Name of the behavior' })
  name!: string;

  @ApiProperty({ description: 'Created by user ID' })
  createdBy?: number;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt!: Date;
}
