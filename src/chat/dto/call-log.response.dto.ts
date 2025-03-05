import { ApiProperty } from '@nestjs/swagger';
import { ChatStatus } from '../../common/entities/chat.entity';

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

class CallDetails {
  @ApiProperty({ required: false })
  summary?: string;

  @ApiProperty({ required: false })
  tags?: string;

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
  callQuality?: number;
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
