import { ApiProperty } from '@nestjs/swagger';
import { ScenarioSessionStatus } from '../enum/scenario-session-status.enum';
import { UserInfo } from 'src/chat/dto/call-log.response.dto';
import { ScenarioResponse } from './scenario-response.dto';

export class ScenarioSessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  scenarioId!: number;

  @ApiProperty()
  counselorId!: number;

  @ApiProperty()
  status!: ScenarioSessionStatus;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty()
  endedAt!: Date;

  @ApiProperty()
  score!: number;

  @ApiProperty()
  metadata!: Record<string, any>;

  @ApiProperty()
  scenario!: ScenarioResponse;

  @ApiProperty()
  counselor!: UserInfo;
}
