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
  'languageVoices',
  'experienceMode',
  'behaviorInstructions',
  'characterProfileText',
  'competencyId',
];

// FEATURE_CLEANUP(FEATURE_SCENARIO_BEHAVIOR_STATE_INSTRUCTIONS): Remove this const
export const SCENARIO_MANDATORY_FIELDS_WITH_STATE_INSTRUCTIONS: (keyof CreateScenarioDto)[] =
  [
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
    'languageVoices',
    'experienceMode',
    'stateInstructions',
    'behaviorInstructions',
    'characterProfileText',
    'competencyId',
  ];
