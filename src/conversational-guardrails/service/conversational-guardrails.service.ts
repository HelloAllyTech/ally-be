import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ConversationalGuardrailsRepository } from '../repository/conversational-guardrails.repository';
import { ConversationalGuardrailsTranslationsRepository } from '../repository/conversational-guardrails-translations.repository';
import { ConversationalGuardrailsTranslationService } from './conversational-guardrails-translation.service';
import {
  CreateConversationalGuardrailDto,
  UpdateConversationalGuardrailDto,
  CreateConversationalGuardrailTranslationDto,
  UpdateConversationalGuardrailTranslationDto,
} from '../dto/conversational-guardrails.dto';
import { Pagination } from 'src/common/type/common.type';
import { ConversationalGuardrails } from '../entity/conversational-guardrails.entity';

const MAX_GUARDRAILS_PER_SESSION = 25;

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
    await this.translationService.createUpdateGuardrailTranslations([saved]);
    return saved;
  }

  async createGuardrails(createDtos: CreateConversationalGuardrailDto[]) {
    const guardrails = this.guardrailsRepository.create(createDtos);
    const saved = await this.guardrailsRepository.save(guardrails);
    await this.translationService.createUpdateGuardrailTranslations(saved);
    return saved;
  }

  async updateGuardrail(id: string, updateDto: UpdateConversationalGuardrailDto) {
    const guardrail = await this.getGuardrailById(id);
    Object.assign(guardrail, updateDto);
    const saved = await this.guardrailsRepository.save(guardrail);
    await this.translationService.createUpdateGuardrailTranslations([saved]);
    return saved;
  }

  async deleteGuardrail(id: string) {
    const guardrail = await this.getGuardrailById(id);
    await this.translationsRepository.delete({ guardrailId: id });
    await this.guardrailsRepository.remove(guardrail);
    return { success: true };
  }

  async deleteGuardrails(ids: string[]) {
    await this.translationsRepository.delete({ guardrailId: In(ids) });
    await this.guardrailsRepository.delete(ids);
    return { success: true };
  }

  async countGuardrails(search?: string) {
    return this.guardrailsRepository.countGuardrails(search);
  }

  async getRandomGuardrailsForSession(languageId?: number) {
    const guardrails = await this.guardrailsRepository.getRandomGuardrails(
      MAX_GUARDRAILS_PER_SESSION,
    );

    if (languageId) {
      const guardrailIds = guardrails.map((g) => g.id);
      const translations =
        await this.translationsRepository.getTranslationsForGuardrails(
          guardrailIds,
          languageId,
        );

      const translationMap = new Map(
        translations.map((t) => [t.guardrailId, t]),
      );

      return guardrails.map((guardrail) => {
        const translation = translationMap.get(guardrail.id);
        if (translation) {
          return {
            ...guardrail,
            helperDialogue: translation.helperDialogue,
            actorDialogue: translation.actorDialogue,
          };
        }
        return guardrail;
      });
    }

    return guardrails;
  }

  formatGuardrailsForPrompt(guardrails: ConversationalGuardrails[]): string {
    if (guardrails.length === 0) {
      return '';
    }

    const guardrailLines = guardrails.map(
      (g) =>
        `If helper said something that can be classified as "${g.helperDialogue}", your response must start with "${g.actorDialogue}"`,
    );

    return `Consider the following guardrails:\n${guardrailLines.join('\n')}`;
  }

  async createTranslation(createDto: CreateConversationalGuardrailTranslationDto) {
    await this.getGuardrailById(createDto.guardrailId);
    const translation = this.translationsRepository.create(createDto);
    return this.translationsRepository.save(translation);
  }

  async updateTranslation(
    id: string,
    updateDto: UpdateConversationalGuardrailTranslationDto,
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

  async deleteTranslation(id: string) {
    const translation = await this.translationsRepository.findOne({
      where: { id },
    });
    if (!translation) {
      throw new NotFoundException(`Translation with id ${id} not found`);
    }
    await this.translationsRepository.remove(translation);
    return { success: true };
  }

  async getTranslationsByGuardrailId(guardrailId: string) {
    return this.translationsRepository.getTranslationsByGuardrailId(guardrailId);
  }
}
