import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ScenarioBehaviorInstructionRepository } from '../repository/scenario-behavior-instruction.repository';
import { ScenarioBehaviorInstructionBehaviorRepository } from '../repository/scenario-behavior-instruction-behavior.repository';
import { BehaviorService } from './behavior.service';
import { BehaviorInstructionDto } from '../dto/behavior-instruction.dto';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';
import { ScenarioBehaviorInstructionBehavior } from '../entity/scenario-behavior-instruction-behavior.entity';
import {
  BehaviorMappingRequestType,
  MergedBehaviorInstructions,
  ScenarioBehaviorInstructionRequest,
} from '../type/scenario-behavior-instructions.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioBehaviorInstructionTranslationService } from './scenario-behavior-instruction-translation.service';
import { ScenarioBehaviorInstructionTranslationRepository } from '../repository/scenario-behavior-instruction-translation.repository';

@Injectable()
export class ScenarioBehaviorInstructionService {
  private readonly logger = LoggerService.getInstance(
    ScenarioBehaviorInstructionService.name,
  );

  constructor(
    private readonly scenarioBehaviorInstructionRepository: ScenarioBehaviorInstructionRepository,
    private readonly scenarioBehaviorInstructionBehaviorRepository: ScenarioBehaviorInstructionBehaviorRepository,
    private readonly behaviorService: BehaviorService,
    private readonly scenarioBehaviorInstructionTranslationService: ScenarioBehaviorInstructionTranslationService,
    private readonly scenarioBehaviorInstructionTranslationRepository: ScenarioBehaviorInstructionTranslationRepository,
  ) {}

  /**
   * Validates that all behavior IDs referenced in the instructions exist in the database.
   * This ensures data integrity before creating or updating behavior instructions.
   *
   * @param behaviorInstructions - Array of behavior instruction DTOs to validate
   * @throws NotFoundException if any behavior ID doesn't exist
   */
  async validateBehaviorInstructions(
    behaviorInstructions: BehaviorInstructionDto[] | undefined,
  ): Promise<void> {
    this.logger.debug(
      `Validating behavior instructions: ${behaviorInstructions?.length || 0} instructions`,
    );

    if (!behaviorInstructions || behaviorInstructions.length === 0) {
      this.logger.debug('No behavior instructions to validate');
      return;
    }

    // Collect all behavior IDs from all instructions
    const allBehaviorIds: string[] = [];
    behaviorInstructions.forEach((instruction) => {
      if (instruction.behaviors) {
        allBehaviorIds.push(...instruction.behaviors);
      }
    });

    // Remove duplicates to avoid redundant validation calls
    const uniqueBehaviorIds = [...new Set(allBehaviorIds)];

    this.logger.debug(
      `Validating ${uniqueBehaviorIds.length} unique behavior IDs`,
    );

    // Validate all behavior IDs exist in the database
    if (uniqueBehaviorIds.length > 0) {
      await this.behaviorService.validateBehaviorIds(uniqueBehaviorIds);
      this.logger.debug('All behavior IDs validated successfully');
    }
  }

  /**
   * Creates behavior instructions for one or more scenarios.
   * This method handles the creation of both instruction entities and their behavior mappings.
   *
   * @param req - Array of scenario behavior instruction requests, each containing scenarioId and behaviorInstructions
   * @param em - Optional EntityManager for transaction support
   * @throws UnauthorizedException if user is not authenticated
   * @throws NotFoundException if any behavior ID doesn't exist (from validation)
   */
  async createBehaviorInstructions(
    req: ScenarioBehaviorInstructionRequest[],
    em?: EntityManager,
  ): Promise<void> {
    this.logger.info(
      `Creating behavior instructions for ${req.length} scenario(s)`,
    );

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      this.logger.error('Unauthorized: User ID not found in execution context');
      throw new UnauthorizedException();
    }
    const userIdNumber = Number(userId);
    this.logger.debug(`Creating instructions for user: ${userIdNumber}`);

    // Validate all behavior IDs exist before proceeding
    await this.validateBehaviorInstructions(
      req.flatMap((item) => item.behaviorInstructions),
    );

    const instructionRepo = em
      ? em.getRepository(ScenarioBehaviorInstruction)
      : this.scenarioBehaviorInstructionRepository;
    const behaviorMappingRepo = em
      ? em.getRepository(ScenarioBehaviorInstructionBehavior)
      : this.scenarioBehaviorInstructionBehaviorRepository;

    // Flatten and format instructions from all scenarios into a single array
    // Each instruction includes its scenarioId and associated behaviors
    const formattedBehaviorInstructions = req.flatMap((item) =>
      item.behaviorInstructions.map((behaviorInstructionItem) => ({
        scenarioId: item.scenarioId,
        category: behaviorInstructionItem.category,
        instructions: behaviorInstructionItem.instructions,
        createdBy: userIdNumber,
        updatedBy: userIdNumber,
        behaviors: behaviorInstructionItem.behaviors,
      })),
    );

    this.logger.debug(
      `Formatted ${formattedBehaviorInstructions.length} instruction(s) for creation`,
    );

    // Create instruction entities (without behavior mappings)
    const instructionEntities = instructionRepo.create(
      formattedBehaviorInstructions.map((item) => ({
        scenarioId: item.scenarioId,
        category: item.category,
        instructions: item.instructions,
        createdBy: item.createdBy,
        updatedBy: item.updatedBy,
      })),
    );

    // Save all instructions to get their generated IDs
    const savedInstructions = await instructionRepo.save(instructionEntities);
    this.logger.info(
      `Created ${savedInstructions.length} behavior instruction(s)`,
    );

    // Create behavior mappings: link each behavior to its instruction
    // The index mapping ensures each instruction's behaviors are correctly associated
    const formattedInstructionBehaviors = formattedBehaviorInstructions
      .flatMap((item, index) =>
        item?.behaviors?.map((id) => ({
          behaviorId: id,
          scenarioBehaviorInstructionId: savedInstructions[index].id,
        })),
      )
      .filter(
        (
          item,
        ): item is {
          behaviorId: string;
          scenarioBehaviorInstructionId: string;
        } => item !== undefined,
      );

    this.logger.debug(
      `Creating ${formattedInstructionBehaviors.length} behavior mapping(s)`,
    );

    if (formattedInstructionBehaviors?.length > 0) {
      const instructionBehaviorEntities = behaviorMappingRepo.create(
        formattedInstructionBehaviors,
      );

      await behaviorMappingRepo.save(instructionBehaviorEntities);
      this.logger.info(
        `Successfully created behavior instructions and mappings for ${req.length} scenario(s)`,
      );
      this.scenarioBehaviorInstructionTranslationService.createUpdateInstructionTranslations(
        savedInstructions,
      );
    }
  }

  /**
   * Updates behavior instructions for a scenario.
   * This method performs a full sync operation:
   * - Creates new instructions that don't have IDs
   * - Updates existing instructions that have matching IDs
   * - Soft deletes instructions that are no longer in the request
   * - Syncs behavior mappings (adds new, removes deleted, updates changed)
   *
   * @param scenarioId - The scenario ID to update instructions for
   * @param behaviorInstructions - Array of behavior instructions (new and existing)
   * @param em - Optional EntityManager for transaction support
   * @throws UnauthorizedException if user is not authenticated
   * @throws NotFoundException if any behavior ID doesn't exist (from validation)
   */
  async updateBehaviorInstructions(
    { scenarioId, behaviorInstructions }: ScenarioBehaviorInstructionRequest,
    em?: EntityManager,
  ): Promise<void> {
    this.logger.info(
      `Updating behavior instructions for scenario ${scenarioId} with ${behaviorInstructions.length} instruction(s)`,
    );
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      this.logger.error('Unauthorized: User ID not found in execution context');
      throw new UnauthorizedException();
    }
    const userIdNumber = Number(userId);
    this.logger.debug(`Updating instructions for user: ${userIdNumber}`);

    // Validate all behavior IDs exist before proceeding
    await this.validateBehaviorInstructions(behaviorInstructions);

    // Use transaction repository if provided, otherwise use default repository
    const instructionRepo = em
      ? em.getRepository(ScenarioBehaviorInstruction)
      : this.scenarioBehaviorInstructionRepository;

    // Get all existing (non-deleted) instructions for this scenario
    const existingInstructions = await instructionRepo.find({
      where: {
        scenarioId,
      },
    });
    this.logger.debug(
      `Found ${existingInstructions.length} existing instruction(s) for scenario ${scenarioId}`,
    );

    const existingInstructionIds = new Set(
      existingInstructions.map((inst) => inst.id),
    );

    // Categorize instructions:
    // 1. Instructions to remove: exist in DB but not in the request
    // 2. Instructions to update: have IDs that match existing instructions
    // 3. Instructions to create: don't have IDs or IDs don't match existing
    const instructionsToCreate: BehaviorInstructionDto[] = [];
    const instructionsToUpdate: BehaviorInstructionDto[] = [];
    const instructionIdsToRemove: string[] = existingInstructions
      .filter(
        (instructionItem) =>
          !behaviorInstructions.some(
            (instruction) => instruction.id === instructionItem.id,
          ),
      )
      .map((item) => item.id);

    // Separate new instructions from updates based on whether they have matching IDs
    for (const instruction of behaviorInstructions) {
      if (instruction.id && existingInstructionIds.has(instruction.id)) {
        instructionsToUpdate.push(instruction);
      } else {
        instructionsToCreate.push(instruction);
      }
    }

    this.logger.debug(
      `Instruction changes: ${instructionsToCreate.length} to create, ${instructionsToUpdate.length} to update, ${instructionIdsToRemove.length} to remove`,
    );

    // Create new instructions
    let createdInstructions: ScenarioBehaviorInstruction[] = [];
    if (instructionsToCreate && instructionsToCreate.length > 0) {
      this.logger.debug(
        `Creating ${instructionsToCreate.length} new instruction(s)`,
      );
      const instructionToCreateEntityInstances = instructionRepo.create(
        instructionsToCreate.map((instruction) => ({
          scenarioId,
          category: instruction.category,
          instructions: instruction.instructions,
          createdBy: userIdNumber,
        })),
      );
      createdInstructions = await instructionRepo.save(
        instructionToCreateEntityInstances,
      );
      this.logger.info(
        `Created ${createdInstructions.length} new behavior instruction(s)`,
      );
    }

    // Update existing instructions
    if (instructionsToUpdate && instructionsToUpdate.length > 0) {
      this.logger.debug(
        `Updating ${instructionsToUpdate.length} existing instruction(s)`,
      );
      const formattedInstructionsToUpdate = instructionsToUpdate.map(
        (item) => ({
          id: item.id,
          category: item.category,
          instructions: item.instructions,
          updatedBy: userIdNumber,
        }),
      );
      await instructionRepo.save(formattedInstructionsToUpdate);
      this.logger.info(
        `Updated ${instructionsToUpdate.length} behavior instruction(s)`,
      );
    }

    // Soft delete instructions that are no longer in the request
    if (instructionIdsToRemove && instructionIdsToRemove.length > 0) {
      this.logger.debug(
        `Soft deleting ${instructionIdsToRemove.length} instruction(s)`,
      );
      await instructionRepo.softDelete({
        id: In(instructionIdsToRemove),
      });
      await this.scenarioBehaviorInstructionTranslationRepository.deleteByInstructionIds(
        instructionIdsToRemove,
      );
      this.logger.info(
        `Soft deleted ${instructionIdsToRemove.length} behavior instruction(s) and deleted translations`,
      );
    }

    const mergedCreatedInstructions = this.getMergedCreatedBehaviorInstructions(
      createdInstructions,
      instructionsToCreate,
    );

    await this.handleBehaviorMapping(
      {
        createdInstructions: mergedCreatedInstructions,
        scenarioId,
        updatedInstructions: instructionsToUpdate,
        removedInstructionIds: instructionIdsToRemove,
        existingInstructionIds: Array.from(existingInstructionIds),
      },
      em,
    );

    const allActiveInstructions = await instructionRepo.find({
      where: { scenarioId },
    });
    this.scenarioBehaviorInstructionTranslationService.createUpdateInstructionTranslations(
      allActiveInstructions,
    );
  }

  private getMergedCreatedBehaviorInstructions(
    newlyCreatedInstructions: ScenarioBehaviorInstruction[],
    instructionToCreateInput: BehaviorInstructionDto[],
  ): MergedBehaviorInstructions[] {
    return newlyCreatedInstructions.map((item, index) => ({
      ...item,
      behaviors: instructionToCreateInput[index]?.behaviors,
    }));
  }

  private async handleBehaviorMapping(
    request: BehaviorMappingRequestType,
    em?: EntityManager,
  ) {
    const {
      scenarioId,
      existingInstructionIds,
      createdInstructions,
      updatedInstructions,
      removedInstructionIds,
    } = request;
    const behaviorMappingRepo = em
      ? em.getRepository(ScenarioBehaviorInstructionBehavior)
      : this.scenarioBehaviorInstructionBehaviorRepository;
    // Step 4: Sync behavior mappings
    // Fetch all existing behavior mappings for all instructions (existing + newly created)
    // This is needed to compare against the incoming data and determine what to add/remove
    const existingBehaviors = await behaviorMappingRepo.find({
      where: {
        scenarioBehaviorInstructionId: In(existingInstructionIds),
      },
    });
    this.logger.debug(
      `Found ${existingBehaviors.length} existing behavior mapping(s)`,
    );

    // Collect behavior mappings to create:
    // 1. Mappings for newly created instructions
    const behaviorsToCreate = createdInstructions.flatMap(
      (instruction) =>
        instruction?.behaviors?.map((behaviorId) => ({
          scenarioBehaviorInstructionId: instruction.id,
          behaviorId,
        })) ?? [],
    );

    // Collect behavior mappings to delete:
    // 1. Mappings for instructions that are being removed
    const behaviorsToDelete = existingBehaviors
      .filter((instructionBehavior) =>
        removedInstructionIds.find(
          (id) => id === instructionBehavior.scenarioBehaviorInstructionId,
        ),
      )
      .map((instructionBehavior) => ({
        id: instructionBehavior.id,
      }));

    // 2. For each updated instruction, find behavior mappings that need to be added/removed
    for (const instruction of updatedInstructions) {
      // Get existing behaviors for this specific instruction
      const existingBehaviorsWithInstructionId = existingBehaviors.filter(
        (instructionBehavior) =>
          instruction.id &&
          instructionBehavior.scenarioBehaviorInstructionId === instruction.id,
      );

      // Find behaviors to remove: exist in DB but not in the request
      const instructionsBehaviorsToDelete = existingBehaviorsWithInstructionId
        .filter(
          (instructionBehavior) =>
            !instruction?.behaviors?.includes(instructionBehavior.behaviorId),
        )
        .map((instructionBehavior) => ({
          id: instructionBehavior.id,
        }));
      if (instructionsBehaviorsToDelete.length > 0) {
        behaviorsToDelete.push(...instructionsBehaviorsToDelete);
      }

      // Find behaviors to add: exist in request but not in DB
      const instructionsBehaviorsToAdd = instruction?.behaviors
        ?.filter(
          (behaviorId: string) =>
            !existingBehaviorsWithInstructionId.some(
              (instructionBehavior) =>
                instructionBehavior.behaviorId === behaviorId,
            ),
        )
        .map((behaviorId) => ({
          behaviorId,
          scenarioBehaviorInstructionId: instruction.id!,
        }));
      if (
        instructionsBehaviorsToAdd &&
        instructionsBehaviorsToAdd?.length > 0
      ) {
        behaviorsToCreate.push(...instructionsBehaviorsToAdd);
      }
    }

    // Delete behavior mappings that are no longer needed
    if (behaviorsToDelete.length > 0) {
      this.logger.debug(
        `Deleting ${behaviorsToDelete.length} behavior mapping(s)`,
      );
      await behaviorMappingRepo.delete(behaviorsToDelete);
      this.logger.info(
        `Deleted ${behaviorsToDelete.length} behavior mapping(s)`,
      );
    }

    // Create new behavior mappings
    if (behaviorsToCreate.length > 0) {
      this.logger.debug(
        `Creating ${behaviorsToCreate.length} behavior mapping(s)`,
      );
      const instructionBehaviorEntityInstances =
        behaviorMappingRepo.create(behaviorsToCreate);
      await behaviorMappingRepo.save(instructionBehaviorEntityInstances);
      this.logger.info(
        `Created ${behaviorsToCreate.length} behavior mapping(s)`,
      );
    }

    this.logger.info(
      `Successfully updated behavior instructions for scenario ${scenarioId}`,
    );
  }

  async getScenarioBehaviorInstructionById(
    id: string,
  ): Promise<ScenarioBehaviorInstruction | null> {
    return this.scenarioBehaviorInstructionRepository.findOne({
      where: {
        id,
      },
    });
  }
}
