import { Injectable } from '@nestjs/common';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

@Injectable()
export class LearnMessageProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    LearnMessageProcessor.name,
  );

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.MESSAGE;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    this.logger.debug(`Processing learn message: ${JSON.stringify(data)}`);

    const { room_id, data: learnMessageData } = data;

    if (room_id.startsWith('preview-')) {
      return;
    }

    const { chat_message } = learnMessageData;

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        this.logger.warn(`Scenario session not found: ${room_id}`);
        return;
      }

      if (!chat_message) {
        this.logger.warn(`Chat message not found: ${room_id}`);
        return;
      }

      await this.scenarioSessionService.addScenarioSessionMessage(
        scenarioSession.id,
        scenarioSession.counselorId,
        chat_message,
        scenarioSession.tenantId,
      );

      this.logger.debug(
        `Scenario session message added: ${scenarioSession.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process learn message: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
