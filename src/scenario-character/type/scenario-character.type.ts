import {
  ScenarioCharacterSortBy,
  ScenarioCharacterSortOrder,
} from '../enum/scenario-character.enum';

export type ScenarioCharacterGetOptions = {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: ScenarioCharacterSortBy;
  sortOrder?: ScenarioCharacterSortOrder;
};
