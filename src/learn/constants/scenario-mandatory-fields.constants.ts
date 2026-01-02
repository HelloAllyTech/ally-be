import { CreateScenarioDto } from '../dto/create-scenario.dto';

// FEATURE_CLEANUP(FEATURE_SCENARIO_CUSTOM_FIELDS): Remove this const
export const SCENARIO_MANDATORY_FIELDS_WITHOUT_CUSTOM_FIELDS: (keyof CreateScenarioDto)[] =
  [
    'title',
    'description',
    'coverImageUrl',
    'agentGoal',
    'lifeHistory',
    'voiceId',
    'name',
    'age',
    'gender',
    'currentLocation',
    'context',
    'openingStatements',
  ];

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
  'responseLength',
  'genderIdentity',
  'sexualOrientation',
  'context',
  'openingStatements',
  'voiceId',
  'languageVoices',
  'agentDialogues',
];
