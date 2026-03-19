import { CreateScenarioDto } from '../dto/create-scenario.dto';

export const SCENARIO_MANDATORY_FIELDS: (keyof CreateScenarioDto)[] = [
  'title',
  'description',
  'coverImageUrl',
  'difficultyLevel',
  'name',
  'age',
  'gender',
  'currentLocation',
  'prompt',
  'openingStatements',
  'voiceId',
  'languageVoices',
  'experienceMode',
  'stateInstructions',
  'behaviorInstructions',
  'characterProfileText',
  'competencyId',
];
