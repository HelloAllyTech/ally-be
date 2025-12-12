import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class LearnEventProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(LearnEventProcessor.name);

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return 'event';
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    this.logger.info(`Processing learn event: ${JSON.stringify(data)}`);

    const { room_id, data: learnData } = data;

    const { event } = learnData;

    try {
      if (room_id.startsWith('preview-')) {
        if (event?.event_data.autoTerminationStatus) {
          await this.scenarioSessionService.endPreviewScenario(room_id);
        }
        return;
      } else {
        const scenarioSession =
          await this.scenarioSessionService.getScenarioSessionByRoomId(room_id);

        if (!scenarioSession) {
          this.logger.warn(`Scenario session not found: ${room_id}`);
          return;
        }

        if (!event) {
          this.logger.warn(`Event not found: ${room_id}`);
          return;
        }

        await this.scenarioSessionService.handleScenarioSessionEvent(
          scenarioSession,
          event,
        );
        this.logger.info(`Scenario session event added: ${scenarioSession.id}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process learn event: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
