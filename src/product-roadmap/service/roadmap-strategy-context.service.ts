import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GlobalSettings } from 'src/settings/entity/global-settings.entity';
import { User } from 'src/user/entity/user.entity';

import { ROADMAP_STRATEGY_CONTEXT_SETTING } from '../constants/product-roadmap.constants';
import {
  RoadmapStrategyContextDto,
  UpdateRoadmapStrategyContextDto,
} from '../dto/roadmap-strategy.dto';

/** The editable fields, in the order the page and the copilot's context both present them. */
const FIELDS = ['vision', 'audience', 'bets', 'nonGoals', 'metrics'] as const;
type StrategyField = (typeof FIELDS)[number];

/**
 * The roadmap's Vision & strategy page: the one document the opportunity copilot always reads.
 *
 * Without it the copilot could judge whether a draft was CLEAR (the five readiness criteria)
 * but not whether it was WORTH DOING — there was nothing anywhere saying what Ally is for, who
 * it serves first, what it is betting on this period, or what it has decided not to do.
 * Strategy goals exist, but as names only; this is the prose behind them.
 *
 * Stored as one `global_settings` row (ROADMAP_STRATEGY_CONTEXT_SETTING). Last write wins —
 * it is a document a handful of managers edit a few times a quarter, and an optimistic-lock
 * column would be ceremony for a collision that has not happened.
 */
@Injectable()
export class RoadmapStrategyContextService {
  constructor(
    @InjectRepository(GlobalSettings)
    private readonly settingsRepository: Repository<GlobalSettings>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async get(): Promise<RoadmapStrategyContextDto> {
    const row = await this.settingsRepository.findOne({
      where: { name: ROADMAP_STRATEGY_CONTEXT_SETTING },
    });
    const value = (row?.value ?? {}) as Partial<Record<StrategyField, unknown>>;
    const fields = Object.fromEntries(
      FIELDS.map((field) => [
        field,
        typeof value[field] === 'string' ? (value[field] as string) : '',
      ]),
    ) as Record<StrategyField, string>;

    let updatedByName: string | null = null;
    if (row?.updatedBy) {
      const user = await this.userRepository.findOne({
        where: { id: row.updatedBy },
        select: { id: true, name: true, email: true },
      });
      updatedByName = user?.name || user?.email || null;
    }

    return {
      ...fields,
      updatedAt: row?.updatedAt ?? null,
      updatedByName,
    };
  }

  async update(
    userId: number,
    dto: UpdateRoadmapStrategyContextDto,
  ): Promise<RoadmapStrategyContextDto> {
    const current = await this.get();
    // A PATCH in spirit: a field left out keeps its text, so a client that only knows some
    // fields cannot blank the rest.
    const value = Object.fromEntries(
      FIELDS.map((field) => [
        field,
        (dto[field] ?? current[field] ?? '').trim(),
      ]),
    );

    const existing = await this.settingsRepository.findOne({
      where: { name: ROADMAP_STRATEGY_CONTEXT_SETTING },
    });
    if (existing) {
      existing.value = value;
      existing.updatedBy = userId;
      await this.settingsRepository.save(existing);
    } else {
      await this.settingsRepository.save(
        this.settingsRepository.create({
          name: ROADMAP_STRATEGY_CONTEXT_SETTING,
          value,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }
    return this.get();
  }

  /**
   * The page as the copilot reads it: headed sections, blank ones named as blank.
   *
   * Naming the gaps is deliberate. A copilot told nothing about non-goals cannot tell "we have
   * none" from "nobody wrote them down", and it should say so to the admin rather than treat
   * silence as permission.
   */
  async renderForCopilot(): Promise<string> {
    const page = await this.get();
    const section = (title: string, body: string) =>
      `### ${title}\n${body.trim() || '(not written yet)'}`;
    return [
      section('Product vision', page.vision),
      section('Who we serve, and who first', page.audience),
      section("This period's strategic bets", page.bets),
      section('Explicit non-goals', page.nonGoals),
      section('How we measure success', page.metrics),
    ].join('\n\n');
  }
}
