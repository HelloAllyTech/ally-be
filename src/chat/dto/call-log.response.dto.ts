import { ApiProperty } from '@nestjs/swagger';
import { ChatStatus } from '../entity/chat.entity';
import { FlattenedSummaryNotePayloadCamelCase } from '../type/call.details.type';
import {
  AudioChatPlatform,
  AudioChatProvider,
} from '../../common/constants/chat.constants';
import { SummaryFeedback } from '../entity/summary-feedback.entity';

export class UserInfo {
  @ApiProperty()
  id?: number;

  @ApiProperty()
  name?: string;

  @ApiProperty()
  email?: string;

  @ApiProperty()
  role?: string;
}

export class CallInfo {
  @ApiProperty({ required: false })
  clientTalkingPercentage?: number;

  @ApiProperty({ required: false })
  counselorTalkingPercentage?: number;

  @ApiProperty({ required: false })
  counselorWordCount?: number;

  @ApiProperty({ required: false })
  clientWordCount?: number;

  @ApiProperty({ required: false })
  provider?: AudioChatProvider;

  @ApiProperty({ required: false })
  callId?: string;

  @ApiProperty({ required: false })
  clientTalkingTime?: number;

  @ApiProperty({ required: false })
  counselorTalkingTime?: number;

  @ApiProperty({ required: false })
  summaryName?: string;

  @ApiProperty({ required: false })
  pauseChat?: boolean;

  // Call initiated platform
  @ApiProperty({ required: false })
  platform?: AudioChatPlatform;

  @ApiProperty({ required: false })
  notes?: string;

  @ApiProperty({ required: false })
  isSummaryFeedbackAdded?: boolean;
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

  @ApiProperty({ type: UserInfo })
  counselor?: UserInfo;

  @ApiProperty({ type: CallDetails })
  details?: CallDetails;
}

export class CounselorNameResponse {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class TagsResponse {
  @ApiProperty({ type: [String] })
  tags!: string[];
}

export class SummaryFeedbackResponse {
  @ApiProperty()
  message!: string;

  @ApiProperty()
  feedback?: SummaryFeedback;
}
