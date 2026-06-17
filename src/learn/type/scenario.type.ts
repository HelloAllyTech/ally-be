export enum ScenarioStatus {
  DRAFT = 'DRAFT',
  COMING_SOON = 'COMING_SOON',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum ScenarioSortBy {
  ID = 'id',
  TITLE = 'title',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  USAGE = 'usage',
}

export enum ScenarioDifficultyLevel {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export enum ExperienceMode {
  FEEDBACK = 'FEEDBACK',
  CHECKLIST = 'CHECKLIST',
  NONE = 'NONE',
}

export enum ChecklistType {
  GUIDED = 'GUIDED',
  UNGUIDED = 'UNGUIDED',
  LIST = 'LIST',
}

export interface ScenarioExperienceMetadata {
  experienceMode: ExperienceMode;
  checklistType: ChecklistType;
}

export interface ChecklistItem {
  id: string;
  score?: number;
  name: string;
  message?: string;
}
export interface StateNames {
  name: string;
  stateId: string;
}

import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { Languages } from 'src/language/entity/languages.entity';

export interface CreateRoomMetadataOptions {
  scenario: GetAdminScenarioDto;
  sessionEvents: SessionEvents[];
  languageDetails?: Languages | null;
  previousMemory?: string | null;
  // Whether the Thinking Filler feature is allowed for this session's user
  // (email allowlist). Fail-closed: when not explicitly true, the filler is
  // stripped from the room metadata so the agent never plays it.
  thinkingFillerAllowed?: boolean;
}

export interface ScenarioAppLangugeTranslations {
  title?: string;
  description?: string;
}
