import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioBehaviorInstructionService } from '../service/scenario-behavior-instruction.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

@Injectable()
export class BehaviorInstructionProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    BehaviorInstructionProcessor.name,
  );

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly scenarioBehaviorInstructionService: ScenarioBehaviorInstructionService,
  ) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.BEHAVIOR_INSTRUCTION;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    this.logger.info(
      `Processing behavior instruction: ${JSON.stringify(data)}`,
    );

    const { room_id, data: learnData } = data;
    const { behavior_instruction } = learnData;

    try {
      if (room_id.startsWith('preview-')) {
        return;
      }

      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        this.logger.warn(`Scenario session not found: ${room_id}`);
        return;
      }

      if (!behavior_instruction) {
        this.logger.warn(`Behavior instruction data is missing: ${room_id}`);
        return;
      } else {
        const { behaviorInstructionId } =
          behavior_instruction.behavior_instruction_data;
        const scenarioBehaviorInstruction =
          await this.scenarioBehaviorInstructionService.getScenarioBehaviorInstructionById(
            behaviorInstructionId,
          );

        if (!scenarioBehaviorInstruction) {
          this.logger.warn(
            `Scenario behavior instruction not found: ${behaviorInstructionId}`,
          );
          return;
        }
      }

      await this.scenarioSessionService.addScenarioSessionBehaviorInstruction(
        scenarioSession,
        behavior_instruction,
      );
      this.logger.info(
        `Scenario session behavior instruction added: ${scenarioSession.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process behavior instruction: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
