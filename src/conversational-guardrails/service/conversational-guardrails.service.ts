import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConversationalGuardrails } from '../entity/conversational-guardrails.entity';
import { ConversationalGuardrailsRepository } from '../repository/conversational-guardrails.repository';
import { CreateConversationalGuardrailDto } from '../dto/create-conversational-guardrails.dto';
import { Pagination } from 'src/common/type/common.type';
import { MAX_GUARDRAILS_PER_SESSION } from '../constants/guardrails.constants';
import { GuardrailMetadata } from '../types/guardrail-translation.types';
import { UpdateConversationalGuardrailDto } from '../dto/update-conversational-guardrails.dto';

@Injectable()
export class ConversationalGuardrailsService {
  constructor(
    private guardrailsRepository: ConversationalGuardrailsRepository,
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
    return this.guardrailsRepository.save(guardrail);
  }

  async updateGuardrail(
    id: string,
    updateDto: UpdateConversationalGuardrailDto,
  ) {
    const guardrail = await this.getGuardrailById(id);
    // Mandatory (system) guardrails cannot be disabled or deleted (the admin
    // dashboard deletes by setting active=false). Their dialogue text remains
    // editable so super admins can refine the gibberish definition.
    if (guardrail.mandatory && updateDto.active === false) {
      throw new ForbiddenException(
        'This guardrail is mandatory and cannot be disabled or deleted.',
      );
    }
    Object.assign(guardrail, updateDto);
    return this.guardrailsRepository.save(guardrail);
  }

  async getRandomGuardrailsForSession() {
    const systemGuardrails =
      await this.guardrailsRepository.getSystemGuardrails();
    const userGuardrails =
      await this.guardrailsRepository.getRandomUserGuardrails(
        Math.max(MAX_GUARDRAILS_PER_SESSION - systemGuardrails.length, 0),
      );

    // Guardrails are not translated: the classifier judges the utterance
    // against the boundary regardless of language, and the branching prompt
    // makes the actor reply in the session language. The same guardrails
    // therefore apply to every language.
    const toMetadata = (g: ConversationalGuardrails): GuardrailMetadata => ({
      helperDialogue: g.helperDialogue,
      actorDialogue: g.actorDialogue,
      kind: g.kind,
    });
    const systemItems = systemGuardrails.map(toMetadata);
    const userItems = userGuardrails.map(toMetadata);

    return {
      // SYSTEM guardrails fire dynamically via their branching instruction, so
      // they are listed first but excluded from the static "must start with"
      // prompt block. They remain in `items` so the agent creates a
      // GuardrailEvent for them.
      prompt: this.formatGuardrailsForPrompt(userItems),
      items: [...systemItems, ...userItems],
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
}
