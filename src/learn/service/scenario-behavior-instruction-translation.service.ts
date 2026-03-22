import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from './scenario-shared.service';

import { ScenarioBehaviorInstructionTranslationRepository } from '../repository/scenario-behavior-instruction-translation.repository';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';
import { CreateScenarioBehaviorInstructionTranslation } from '../interface/scenario-behavior-instruction-translation.interface';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from '../constants/scenario-session.constants';
import { INSTRUCTION_SEPARATOR } from '../constants/scenario-behavior-instuctions.constants';
import { BehaviorInstructionTranslationService } from './behavior-instruction-translation.service';

@Injectable()
export class ScenarioBehaviorInstructionTranslationService {
  private readonly logger = LoggerService.getInstance(
    ScenarioBehaviorInstructionTranslationService.name,
  );

  constructor(
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly behaviorInstructionTranslationService: BehaviorInstructionTranslationService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly scenarioBehaviorInstructionTranslationRepository: ScenarioBehaviorInstructionTranslationRepository,
  ) {}

  async createUpdateInstructionTranslations(
    instructions: ScenarioBehaviorInstruction[],
  ): Promise<void> {
    const validLanguagesCodes: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguagesCodes || validLanguagesCodes.length === 0) {
      return;
    }

    const { languages } =
      await this.sharedLanguageService.getValidLanguages(validLanguagesCodes);

    if (!languages || languages.length === 0) {
      return;
    }

    await this.persistInstructionTranslations(instructions, languages);
  }

  private async persistInstructionTranslations(
    instructions: Array<ScenarioBehaviorInstruction>,
    languages: any,
  ) {
    for (const instruction of instructions) {
      try {
        const instructionsArray = instruction.instructions?.filter(
          (str) => str && str.trim(),
        );

        const stateInstructionsArray = instruction.stateInstructions?.filter(
          (stateInstruction) =>
            stateInstruction &&
            stateInstruction.instruction &&
            stateInstruction.instruction.trim(),
        );

        // FEATURE_CLEANUP(FEATURE_SCENARIO_BEHAVIOR_STATE_INSTRUCTIONS): Remove instructionArray field
        if (
          (!instructionsArray || instructionsArray.length === 0) &&
          (!stateInstructionsArray || stateInstructionsArray.length === 0)
        ) {
          this.logger?.debug?.(
            `[persistInstructionTranslations] ${instruction.id}: no instructions to translate, skipping`,
          );
          continue;
        }

        const languagesFiltered = (languages ?? []).filter(
          (lang: any) =>
            lang &&
            lang.translationCode &&
            lang.translationCode.trim() !== '' &&
            !lang.value.includes(DEFAULT_LANGUAGE_TRANSLATION_CODE),
        );

        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistInstructionTranslations] ${instruction.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((lang: any) =>
          lang.translationCode.trim(),
        );

        const metadataObj = {
          instructions: instructionsArray?.join(INSTRUCTION_SEPARATOR),
          stateInstructions: stateInstructionsArray,
        };

        const translatedMap =
          await this.behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes(
            metadataObj,
            languageCodes,
          );

        const translatedList: Array<CreateScenarioBehaviorInstructionTranslation> =
          [];

        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || !translatedData.instructions) continue;

          const translatedInstructions = (translatedData.instructions as string)
            .split(INSTRUCTION_SEPARATOR)
            .map((part: string) => part.trim())
            .filter(Boolean);

          if (translatedInstructions.length === 0) continue;

          translatedList.push({
            scenarioBehaviorInstructionId: instruction.id,
            languageId: Number(language.id),
            instructions: translatedInstructions,
            stateInstructions: translatedData.stateInstructions,
          });
        }

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistInstructionTranslations] ${instruction.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }

        const existingTranslations =
          await this.scenarioBehaviorInstructionTranslationRepository.getTranslationsByInstructionId(
            instruction.id,
          );

        const existingLanguageIdSet = new Set(
          (existingTranslations ?? []).map((record) =>
            Number(record.languageId),
          ),
        );

        const toCreate: Array<CreateScenarioBehaviorInstructionTranslation> =
          [];
        const toUpdate: Array<CreateScenarioBehaviorInstructionTranslation> =
          [];

        for (const translation of translatedList) {
          if (existingLanguageIdSet.has(Number(translation.languageId)))
            toUpdate.push(translation);
          else toCreate.push(translation);
        }

        if (toCreate.length) {
          await this.scenarioBehaviorInstructionTranslationRepository.save(
            toCreate,
          );
        }

        if (toUpdate.length) {
          for (const updateItem of toUpdate) {
            await this.scenarioBehaviorInstructionTranslationRepository.update(
              {
                scenarioBehaviorInstructionId:
                  updateItem.scenarioBehaviorInstructionId,
                languageId: updateItem.languageId,
              },
              { instructions: updateItem.instructions },
            );
          }
        }
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistInstructionTranslations] unexpected error processing ${instruction.id}`,
          { outerErr },
        );
      }
    }
  }
}
