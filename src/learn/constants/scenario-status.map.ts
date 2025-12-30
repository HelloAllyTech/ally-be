import { ScenarioStatus } from '../type/scenario.type';

export const SCENARIO_STATUS_MAP = new Map<ScenarioStatus, ScenarioStatus[]>([
  [ScenarioStatus.DRAFT, [ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]],
  [
    ScenarioStatus.ACTIVE,
    [ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE, ScenarioStatus.ARCHIVED],
  ],
  [ScenarioStatus.ARCHIVED, [ScenarioStatus.DRAFT, ScenarioStatus.ARCHIVED]],
]);
