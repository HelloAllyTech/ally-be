import { ApiProperty } from '@nestjs/swagger';
import { ScenarioPath } from '../entity/scenario-path.entity';

export class GetScenarioPathsResponseDto {
  @ApiProperty({
    type: [ScenarioPath],
    description: 'Array of scenario paths',
  })
  data!: ScenarioPath[];

  @ApiProperty({ type: Number, description: 'Total count of scenario paths' })
  count!: number;
}
