import { CreateScenarioDto } from '../dto/create-scenario.dto';

/**
 * Fields a scenario MUST have filled before it can be activated. Used by
 * the FE to grey-out the "Activate" button when something's missing and
 * by the BE's scenario-session/shared services as a guard.
 *
 * This list captures STRUCTURAL scenario metadata — the data needed to
 * uniquely identify, schedule, and run a simulation regardless of which
 * main-agent prompt variant it picks. `competencyId` belongs here even
 * though variants like Prompt #2 don't reference `{competency}` in their
 * body — the competency identifies which counselor skill the scenario
 * trains and feeds analytics / organization / scenario discovery, all
 * of which are independent of the prompt template.
 *
 * Fields that exist purely to feed a prompt placeholder (custom_fields,
 * character_profile_text, role_instructions, knowledge sources, etc.)
 * are intentionally excluded — those are gated by the studio form via
 * `hideWhenUnused` based on whether the selected variant references the
 * placeholder.
 */
export const SCENARIO_MANDATORY_FIELDS: (keyof CreateScenarioDto)[] = [
  'title',
  'description',
  'coverImageUrl',
  'difficultyLevel',
  'name',
  'age',
  'gender',
  'currentLocation',
  'openingStatements',
  'languageVoices',
  'experienceMode',
  'competencyId',
  'stateNames',
];
