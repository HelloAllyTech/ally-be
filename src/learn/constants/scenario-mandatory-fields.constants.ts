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
  'showScoreMeter',
  'competencyId',
];

// FEATURE_CLEANUP(FEATURE_SCENARIO_CUSTOM_FIELDS): Remove this constant
export const SCENARIO_MANDATORY_FIELDS_WITHOUT_STATE_BASED_CHANGES: (keyof CreateScenarioDto)[] =
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
    'context',
    'openingStatements',
    'voiceId',
    'languageVoices',
    'agentDialogues',
    'experienceMode',
  ];
