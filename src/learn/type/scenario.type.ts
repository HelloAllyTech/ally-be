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
  /**
   * Gates the checklist on the learner's post-session summary only. Absent or
   * false means hidden; the in-session checklist panel is driven by
   * `experienceMode` alone and ignores this flag.
   */
  summaryChecklistEnabled?: boolean;
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
}

export interface ScenarioAppLangugeTranslations {
  title?: string;
  description?: string;
}
