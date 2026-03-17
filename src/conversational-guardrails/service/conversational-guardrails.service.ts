import { Injectable, NotFoundException } from '@nestjs/common';

import { ConversationalGuardrailsRepository } from '../repository/conversational-guardrails.repository';
import { ConversationalGuardrailsTranslationsRepository } from '../repository/conversational-guardrails-translations.repository';
import { ConversationalGuardrailsTranslationService } from './conversational-guardrails-translation.service';
import { CreateConversationalGuardrailDto } from '../dto/create-conversational-guardrails.dto';
import { Pagination } from 'src/common/type/common.type';
import { MAX_GUARDRAILS_PER_SESSION } from '../constants/guardrails.constants';
import {
  CreateConversationalGuardrailTranslation,
  GuardrailMetadata,
  UpdateConversationalGuardrailTranslation,
} from '../types/guardrail-translation.types';
import { UpdateConversationalGuardrailDto } from '../dto/update-conversational-guardrails.dto';

@Injectable()
export class ConversationalGuardrailsService {
  constructor(
    private guardrailsRepository: ConversationalGuardrailsRepository,
    private translationsRepository: ConversationalGuardrailsTranslationsRepository,
    private translationService: ConversationalGuardrailsTranslationService,
  ) {}

  async getGuardrails(search?: string, options?: Pagination) {
    return this.guardrailsRepository.getGuardrails(search, options);
  }

  async getGuardrailById(id: string) {
    const guardrail = await this.guardrailsRepository.findOne({
      where: { id },
    });
    if (!guardrail) {
      throw new NotFoundException(`Guardrail with id ${id} not found`);
    }
    return guardrail;
  }

  async createGuardrail(createDto: CreateConversationalGuardrailDto) {
    const guardrail = this.guardrailsRepository.create(createDto);
    const saved = await this.guardrailsRepository.save(guardrail);
    this.translationService.createUpdateGuardrailTranslations([saved]);
    return saved;
  }

  async updateGuardrail(
    id: string,
    updateDto: UpdateConversationalGuardrailDto,
  ) {
    const guardrail = await this.getGuardrailById(id);
    Object.assign(guardrail, updateDto);
    const saved = await this.guardrailsRepository.save(guardrail);
    this.translationService.createUpdateGuardrailTranslations([saved]);
    return saved;
  }

  async getRandomGuardrailsForSession(languageId?: number) {
    const guardrails = await this.guardrailsRepository.getGuardrails(
      undefined,
      { limit: MAX_GUARDRAILS_PER_SESSION },
    );

    let guardrailsResponse = [];

    if (languageId) {
      const guardrailIds = guardrails.map((g) => g.id);
      const translations =
        await this.translationsRepository.getTranslationsForGuardrails(
          guardrailIds,
          languageId,
        );

      guardrailsResponse = translations;
    } else {
      guardrailsResponse = guardrails.map((g) => ({
        helperDialogue: g.helperDialogue,
        actorDialogue: g.actorDialogue,
      }));
    }

    return {
      prompt: this.formatGuardrailsForPrompt(guardrailsResponse),
      items: guardrailsResponse,
    };
  }

  formatGuardrailsForPrompt(guardrails: GuardrailMetadata[]): string {
    if (guardrails.length === 0) {
      return '';
    }

    const guardrailLines = guardrails.map(
      (g) =>
        `If helper said something that can be classified as "${g.helperDialogue}", your response must start with "${g.actorDialogue}"`,
    );

    return `Consider the following guardrails:\n${guardrailLines.join('\n')}`;
  }

  async createTranslation(createDto: CreateConversationalGuardrailTranslation) {
    await this.getGuardrailById(createDto.guardrailId);
    const translation = this.translationsRepository.create(createDto);
    return this.translationsRepository.save(translation);
  }

  async updateTranslation(
    id: string,
    updateDto: UpdateConversationalGuardrailTranslation,
  ) {
    const translation = await this.translationsRepository.findOne({
      where: { id },
    });
    if (!translation) {
      throw new NotFoundException(`Translation with id ${id} not found`);
    }
    Object.assign(translation, updateDto);
    return this.translationsRepository.save(translation);
  }

  async getTranslationsByGuardrailId(guardrailId: string) {
    return this.translationsRepository.getTranslationsByGuardrailId(
      guardrailId,
    );
  }
}
