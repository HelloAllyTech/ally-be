import { ApiProperty } from '@nestjs/swagger';
import { ChatStatus } from '../../common/entities/chat.entity';
import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';

class UserInfo {
  @ApiProperty()
  id?: number;

  @ApiProperty()
  name?: string;

  @ApiProperty()
  email?: string;

  @ApiProperty()
  role?: string;
}
class CallInfo {
  @ApiProperty({ required: false })
  clientTalkingPercentage?: number;

  @ApiProperty({ required: false })
  counselorTalkingPercentage?: number;
}
export class CallDetails {
  @ApiProperty({ required: false })
  transcript?: string;

  @ApiProperty({ required: false })
  noOfNudges?: number;

  @ApiProperty({ required: false })
  noOfStages?: number;

  @ApiProperty({ required: false })
  startTime?: Date;

  @ApiProperty({ required: false })
  endTime?: Date;

  @ApiProperty({ required: false })
  callDuration?: number;

  @ApiProperty({ required: false })
  summary?: FlattenedSummaryNotePayloadCamelCase;

  @ApiProperty({ type: CallInfo })
  callInfo?: CallInfo;
}

export class CallLogResponse {
  @ApiProperty()
  id!: number;

  @ApiProperty({ enum: ChatStatus })
  status!: ChatStatus;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ required: false })
  endedAt?: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: UserInfo })
  client?: UserInfo;

  @ApiProperty({ type: CallDetails })
  details?: CallDetails;
}
