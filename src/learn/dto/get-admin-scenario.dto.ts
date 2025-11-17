import { ApiProperty } from '@nestjs/swagger';
import { Scenarios } from '../entity/scenarios.entity';

class TerminationEventDto {
  @ApiProperty({ required: false })
  eventId?: string;

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  autoTerminationStatus?: boolean;

  @ApiProperty({ required: false })
  message?: string;
}

export class GetAdminScenarioDto extends Scenarios {
  terminationEvent?: TerminationEventDto;
}
