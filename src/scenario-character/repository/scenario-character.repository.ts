import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import { ScenarioCharacterGetOptions as ScenarioCharacterGetOptions } from '../type/scenario-character.type';

@Injectable()
export class ScenarioCharacterRepository extends Repository<ScenarioCharacter> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioCharacter, dataSource.createEntityManager());
  }

  async getScenarioCharactersQuery(
    options: ScenarioCharacterGetOptions = {},
  ): Promise<{ characters: ScenarioCharacter[]; count: number }> {
    const { search, limit, offset, sortBy, sortOrder, tenantId } = options;

    const query = this.createQueryBuilder('scenarioCharacter')
      .orderBy(`scenarioCharacter.${sortBy}`, sortOrder)
      .limit(Number(limit))
      .offset(Number(offset));

    // A tenant-scoped caller sees only their own tenant's characters — not the
    // Ally-owned global ones (tenant_id IS NULL) and not another org's. A
    // platform caller passes no tenantId and gets the unfiltered library.
    if (tenantId) {
      query.andWhere('scenarioCharacter.tenant_id = :tenantId', { tenantId });
    }

    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query.andWhere(
        '(scenarioCharacter.name ILIKE :term OR scenarioCharacter.profession ILIKE :term OR scenarioCharacter.current_location ILIKE :term)',
        { term },
      );
    }

    const [characters, count] = await query.getManyAndCount();
    return { characters, count };
  }

  /**
   * Display names for the `created_by` user ids on a page of characters, plus
   * the owning tenant's name — the "who made this" column a platform admin
   * sees. Batched rather than joined so the entity query above stays a plain
   * getManyAndCount (mixing entity and raw selects breaks its pagination).
   */
  async getCreatorAttribution(
    userIds: number[],
    tenantIds: string[],
  ): Promise<{
    usersById: Map<number, string>;
    tenantNamesById: Map<string, string>;
  }> {
    const usersById = new Map<number, string>();
    const tenantNamesById = new Map<string, string>();

    if (userIds.length) {
      const rows: { id: number; name: string | null; email: string | null }[] =
        await this.dataSource.query(
          `SELECT id, name, email FROM users WHERE id = ANY($1)`,
          [userIds],
        );
      for (const row of rows) {
        usersById.set(row.id, row.name?.trim() || row.email || `#${row.id}`);
      }
    }

    if (tenantIds.length) {
      // tenant_id carries whatever the JWT carries, which is the tenants.id
      // value as text — hence the ::text cast rather than ::uuid (see the
      // scenario_sessions join convention).
      const rows: { id: string; name: string | null; code: string | null }[] =
        await this.dataSource.query(
          `SELECT id::text AS id, name, code FROM tenants WHERE id::text = ANY($1) OR code = ANY($1)`,
          [tenantIds],
        );
      for (const row of rows) {
        const label = row.name?.trim() || row.code || row.id;
        tenantNamesById.set(row.id, label);
        if (row.code) tenantNamesById.set(row.code, label);
      }
    }

    return { usersById, tenantNamesById };
  }
}
