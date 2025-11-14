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
  @ApiProperty({
    required: false,
    example: {
      eventId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Termination Event',
      autoTerminationStatus: true,
      message: 'Termination message',
    },
  })
  terminationEvent?: TerminationEventDto;
}
