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

/**
 * Which post-session tabs a roleplay shows its learner.
 *
 * Sub-toggles of the roleplay-level `enableFeedback` master switch, stored at
 * `scenarios.metadata.feedbackTabs`. Debrief and transcript default to on when
 * unset, so every roleplay authored before those existed keeps its full
 * post-session screen. Skills Demonstrated was switched off platform-wide
 * (2026-08-24) — it now defaults to off unless a scenario's `feedbackTabs`
 * explicitly sets `skills: true`.
 */
export interface FeedbackTabsConfig {
  /** The supervisor debrief note from Ally, and its reply conversation. */
  debrief: boolean;
  /** Score meter, skill bars, distress chart. */
  skills: boolean;
  /** The annotated transcript. */
  transcript: boolean;
}

export const DEFAULT_FEEDBACK_TABS: FeedbackTabsConfig = {
  debrief: true,
  skills: false,
  transcript: true,
};

/**
 * Resolve a roleplay's post-session tab configuration from its metadata.
 *
 * `enableFeedback === false` turns everything off — the master switch keeps its
 * existing meaning. Otherwise debrief and transcript default to ON unless
 * explicitly set to false, and skills defaults to OFF unless explicitly set to
 * true — see `DEFAULT_FEEDBACK_TABS` above.
 */
export function resolveFeedbackTabs(
  scenarioMetadata?: Record<string, any> | null,
): FeedbackTabsConfig {
  if (scenarioMetadata?.enableFeedback === false) {
    return { debrief: false, skills: false, transcript: false };
  }
  const configured = scenarioMetadata?.feedbackTabs;
  if (!configured || typeof configured !== 'object') {
    return { ...DEFAULT_FEEDBACK_TABS };
  }
  return {
    debrief: configured.debrief !== false,
    skills: configured.skills === true,
    transcript: configured.transcript !== false,
  };
}

/**
 * Whether a session needs the evaluation LLM call at all.
 *
 * Every post-session surface is fed by that one call — the note, the skill
 * percentages, and the transcript's per-message tags — so when a roleplay shows
 * none of them, running it would burn a full transcript analysis nobody can
 * ever see.
 */
export function feedbackTabsNeedEvaluation(tabs: FeedbackTabsConfig): boolean {
  return tabs.debrief || tabs.skills || tabs.transcript;
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
