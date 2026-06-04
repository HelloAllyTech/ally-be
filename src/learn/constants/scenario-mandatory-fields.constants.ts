import { CreateScenarioDto } from '../dto/create-scenario.dto';

/**
 * Fields a scenario MUST have filled before it can be activated. Used by
 * the FE to grey-out the "Activate" button when something's missing and
 * by the BE's scenario-session/shared services as a guard.
 *
 * Only these fields are mandatory:
 *  - `title`          — identifies the scenario in listings / discovery.
 *  - `competencyId`   — the counselor skill the scenario trains; feeds
 *                       analytics / organization / scenario discovery,
 *                       independent of the prompt template.
 *  - `prompt`         — the role instructions that shape the actor's
 *                       behaviour.
 *  - `languageVoices` — the language-voice mapping the simulation runs with;
 *                       a session needs at least one language/voice to speak.
 *
 * Everything else (character demographics like name/age/gender/location,
 * description, cover image, difficulty, opening statements, experience mode,
 * states, etc.) is OPTIONAL. The ally-ai-learn runtime treats these as
 * optional too (see PromptData) and renders empty sections when absent
 * rather than failing, so a scenario can be activated without them.
 */
export const SCENARIO_MANDATORY_FIELDS: (keyof CreateScenarioDto)[] = [
  'title',
  'competencyId',
  'prompt',
  'languageVoices',
];
