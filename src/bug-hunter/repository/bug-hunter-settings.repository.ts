import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHunterMode } from '../enum/bug-finding.enum';
import {
  DecisionOwner,
  DecisionPoint,
} from '../type/bug-hunter-orchestrator.type';

const SINGLETON_ID = 1;

@Injectable()
export class BugHunterSettingsRepository extends Repository<BugHunterSettings> {
  constructor(dataSource: DataSource) {
    super(BugHunterSettings, dataSource.createEntityManager());
  }

  /** The one row, seeded `mode=off` by the introducing migration. */
  getSettings(): Promise<BugHunterSettings> {
    return this.findOneOrFail({ where: { id: SINGLETON_ID } });
  }

  async setMode(
    mode: BugHunterMode,
    updatedBy: number,
  ): Promise<BugHunterSettings> {
    await this.update(SINGLETON_ID, { mode, updatedBy });
    return this.getSettings();
  }

  /** Sets one point's owner, or clears it back to the default with `null` (OPP-0783). */
  async setDecisionOwner(
    point: DecisionPoint,
    owner: DecisionOwner | null,
    updatedBy: number,
  ): Promise<BugHunterSettings> {
    const current = await this.getSettings();
    const owners = { ...(current.decisionOwners ?? {}) } as Partial<
      Record<DecisionPoint, DecisionOwner>
    >;
    if (owner) owners[point] = owner;
    else delete owners[point];
    await this.update(SINGLETON_ID, {
      decisionOwners: Object.keys(owners).length ? owners : null,
      updatedBy,
    });
    return this.getSettings();
  }
}
