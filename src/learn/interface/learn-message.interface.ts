import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';

export interface LearnMessageAndEventMessage {
  message_type: string;
  timestamp: number;
  room_id: string;
  data: LearnData;
}

export interface LearnData {
  chat_message?: MessageRequest;
  event?: LearnEventData;
  behavior_instruction?: LearnBehaviorInstructionData;
}

export interface LearnBehaviorInstructionData {
  timestamp: Date;
  behavior_instruction_data: LearnBehaviorInstruction;
}

export interface LearnBehaviorInstruction {
  behaviorInstructionId: string;
}

export interface LearnEventData {
  timestamp: Date;
  event_data: LearnEvent;
}

export interface LearnEvent extends SessionEvents {
  autoTerminationStatus?: boolean;
  terminationMessage?: string;
  totalScore?: number;
}
