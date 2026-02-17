import { ApiProperty } from '@nestjs/swagger';

export class BehaviorResponseDto {
  @ApiProperty({ description: 'ID of the behavior' })
  id!: string;

  @ApiProperty({ description: 'Name of the behavior' })
  name!: string;
}

export class GetBehaviorsResponseDto {
  @ApiProperty({
    type: [BehaviorResponseDto],
    description: 'List of behaviors',
  })
  data!: BehaviorResponseDto[];

  @ApiProperty({ description: 'Total count of behaviors' })
  count!: number;
}
