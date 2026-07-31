import { In, ObjectLiteral, Repository } from 'typeorm';

/**
 * Shared reads for the provider-config registries (`stt_configs`,
 * `llm_configs`). Both tables have the same shape, so both repositories were
 * byte-identical apart from their entity name.
 *
 * `scenario_voices` deliberately does not extend this: it is keyed per language
 * and carries its own gender/fallback query surface.
 */
export abstract class ProviderConfigRepository<
  T extends ObjectLiteral & { id: string; active: boolean },
> extends Repository<T> {
  /**
   * Registry rows for the admin list. `activeOnly` is what the pickers use:
   * a retired config must stay resolvable for anything still pointing at it,
   * but must not be offered as a new choice.
   */
  async listConfigs(activeOnly = false): Promise<T[]> {
    return this.find({
      ...(activeOnly ? { where: { active: true } as any } : {}),
      order: { provider: 'ASC', name: 'ASC' } as any,
    });
  }

  /**
   * Fetch several configs at once, keyed by id — one query per session rather
   * than one per language the simulation references.
   */
  async findMapByIds(ids: string[]): Promise<Map<string, T>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const rows = await this.find({ where: { id: In(unique) } as any });
    return new Map(rows.map((row) => [row.id, row]));
  }
}
