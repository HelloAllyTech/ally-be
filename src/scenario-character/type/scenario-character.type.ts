import {
  ScenarioCharacterSortBy,
  ScenarioCharacterSortOrder,
} from '../enum/scenario-character.enum';
import { ScenarioCharacter } from '../entity/scenario-character.entity';

export type ScenarioCharacterGetOptions = {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: ScenarioCharacterSortBy;
  sortOrder?: ScenarioCharacterSortOrder;
  /**
   * Restrict the result to one tenant's characters. Set for a tenant-scoped
   * caller; omitted for a platform caller, who sees the whole library.
   */
  tenantId?: string | null;
};

/**
 * A character plus the "who made this" fields. Only populated for a platform
 * caller — a tenant admin sees only their own org's rows, so the attribution
 * would say the same thing on every line.
 */
export type ScenarioCharacterWithOwner = ScenarioCharacter & {
  createdByName?: string;
  /** Owning org's display name, or undefined for an Ally-owned character. */
  tenantName?: string;
};
