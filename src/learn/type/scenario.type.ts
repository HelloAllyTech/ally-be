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
 * Which post-session tabs a roleplay shows its learner: the debrief note and
 * the annotated transcript, and nothing else.
 *
 * Stored at `scenarios.metadata.feedbackTabs`; each defaults to on when unset,
 * so a roleplay authored before these existed keeps its full post-session
 * screen.
 *
 * There is no longer a master switch above these two. `enableFeedback` was
 * folded into them on 2026-08-31 — the migration that did it wrote
 * `{debrief: false, transcript: false}` for every roleplay that had it off, so
 * a wholesale opt-out is now expressed as both toggles off and, unlike before,
 * stays visible and editable in the authoring form. Skills Demonstrated was
 * retired in the same pass, having been off platform-wide since 2026-08-24;
 * the evaluator still produces `skillCoverage`, which admin analytics reads.
 */
export interface FeedbackTabsConfig {
  /** The supervisor debrief note from Ally, and its reply conversation. */
  debrief: boolean;
  /** The annotated transcript. */
  transcript: boolean;
}

export const DEFAULT_FEEDBACK_TABS: FeedbackTabsConfig = {
  debrief: true,
  transcript: true,
};

/**
 * Resolve a roleplay's post-session tab configuration from its metadata.
 *
 * Each tab is ON unless explicitly set to false — see `DEFAULT_FEEDBACK_TABS`.
 * `enableFeedback` is deliberately NOT consulted any more: keeping it as a
 * hidden third gate would let a roleplay read as "both tabs on" in the
 * authoring form while showing the learner nothing.
 */
export function resolveFeedbackTabs(
  scenarioMetadata?: Record<string, any> | null,
): FeedbackTabsConfig {
  const configured = scenarioMetadata?.feedbackTabs;
  if (!configured || typeof configured !== 'object') {
    return { ...DEFAULT_FEEDBACK_TABS };
  }
  return {
    debrief: configured.debrief !== false,
    transcript: configured.transcript !== false,
  };
}

/**
 * Whether a session needs the evaluation LLM call at all.
 *
 * Every post-session surface is fed by that one call — the note and the
 * transcript's per-message tags — so when a roleplay shows none of them,
 * running it would burn a full transcript analysis nobody can ever see.
 */
export function feedbackTabsNeedEvaluation(tabs: FeedbackTabsConfig): boolean {
  return tabs.debrief || tabs.transcript;
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
