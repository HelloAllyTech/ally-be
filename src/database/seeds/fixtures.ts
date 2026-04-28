import { randomUUID } from 'crypto';
import { UserRole } from '../../common/constants/user.constants';
import { UserStatus } from '../../user/constants/user-status.constants';
import {
  BadgeCategory,
  BadgeStatus,
  BadgeVisibilityType,
} from '../../badge/constants/badge.constants';
import {
  ExperienceMode,
  ScenarioDifficultyLevel,
  ScenarioResponseLength,
  ScenarioStatus,
} from '../../learn/type/scenario.type';
import { ScenarioPathStatus } from '../../scenario-path/type/scenario-paths.type';
import { CaseStatus } from '../../case/type/cases.type';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../../learn/enum/scenario-session-status.enum';
import { SessionEventDetectionType } from '../../session-event/enum/session-event-detection.enum';
import { SessionEventVisibilityType } from '../../session-event/enum/session-event-visibility-type.enum';
import { TENANT_CODE, TENANT_NAME, ADMIN_EMAIL } from './config';

export interface TenantFixture {
  code: string;
  name: string;
  description: string;
}

export interface UserFixture {
  email: string;
  name: string;
  roles: UserRole[];
}

export interface VoiceFixture {
  name: string;
  provider: string;
  config: Record<string, any>;
}

export interface SessionEventFixture {
  id: string;
  name: string;
  eventCode: string;
  score: number;
  emoji: string;
  message: string;
  detectionType: SessionEventDetectionType;
  detectionData: Record<string, any>;
}

export interface ScenarioFixture {
  key: string;
  title: string;
  description: string;
  metadata: Record<string, any>;
}

export interface PathwayFixture {
  title: string;
  description: string;
  scenarioKeys: string[];
}

export interface BadgeFixture {
  name: string;
  description: string;
  category: BadgeCategory;
  count: number;
  groupNames: UserRole[];
}

export interface CaseFixture {
  title: string;
  description: string;
  scenarioKeys: string[];
}

export interface SessionFixture {
  scenarioKey: string;
  status: ScenarioSessionStatus;
  eventStatus: ScenarioSessionEventStatus;
  score?: number;
  durationMinutes: number;
  transcript: Array<{ from: 'counselor' | 'client'; content: string }>;
}

export const tenant: TenantFixture = {
  code: TENANT_CODE,
  name: TENANT_NAME,
  description: 'Default tenant for local development',
};

export const users: UserFixture[] = [
  {
    email: ADMIN_EMAIL,
    name: 'Admin User',
    roles: [UserRole.SUPER_ADMIN],
  },
  {
    email: 'org-admin@example.com',
    name: 'Org Admin',
    roles: [UserRole.ADMIN],
  },
  {
    email: 'learner@example.com',
    name: 'Learner',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
  },
  {
    email: 'multi-tenant-admin1@example.com',
    name: 'Multi-Tenant Admin',
    roles: [UserRole.MULTI_TENANT_ADMIN],
  },
];

// Default voice per language `value` (e.g. 'en-IN'). Seeder pulls the
// active languages table and creates one voice for each match.
const sarvamAbhilash: Omit<VoiceFixture, 'name'> = {
  provider: 'SARVAM',
  config: {
    age: 'adult',
    model: 'bulbul:v2',
    gender: 'male',
    speaker: 'abhilash',
  },
};

const googleChirp = (
  voiceName: string,
  languageCode: string,
): Omit<VoiceFixture, 'name'> => ({
  provider: 'GOOGLE',
  config: { gender: 'female', voice_name: voiceName, languageCode },
});

export const voiceByLanguageValue: Record<string, VoiceFixture> = {
  'en-IN': {
    name: 'English (India) - Achernar',
    ...googleChirp('en-IN-Chirp3-HD-Achernar', 'en-IN'),
  },
  'en-GB': {
    name: 'English (UK) - Achernar',
    ...googleChirp('en-GB-Chirp3-HD-Achernar', 'en-GB'),
  },
  'en-US': {
    name: 'English (US) - Achernar',
    ...googleChirp('en-US-Chirp3-HD-Achernar', 'en-US'),
  },
  'bn-IN': {
    name: 'Bengali - Achernar',
    ...googleChirp('bn-IN-Chirp3-HD-Achernar', 'bn-IN'),
  },
  'hi-IN': { name: 'Hindi - Abhilash', ...sarvamAbhilash },
  'te-IN': { name: 'Telugu - Abhilash', ...sarvamAbhilash },
  'mr-IN': { name: 'Marathi - Abhilash', ...sarvamAbhilash },
  'ta-IN': { name: 'Tamil - Abhilash', ...sarvamAbhilash },
  'gu-IN': { name: 'Gujarati - Abhilash', ...sarvamAbhilash },
  'kn-IN': { name: 'Kannada - Abhilash', ...sarvamAbhilash },
  'ml-IN': { name: 'Malayalam - Abhilash', ...sarvamAbhilash },
  'pa-IN': { name: 'Punjabi - Abhilash', ...sarvamAbhilash },
  'or-IN': { name: 'Odia - Abhilash', ...sarvamAbhilash },
};

export const sessionEvents: SessionEventFixture[] = [
  {
    id: randomUUID(),
    name: 'Demonstrated active listening',
    eventCode: 'SS-LISTEN',
    score: 5,
    emoji: '👂',
    message: 'Good active listening',
    detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
    detectionData: { sentences: ['That must be hard for you.'] },
  },
  {
    id: randomUUID(),
    name: 'Low score threshold crossed',
    eventCode: 'SC-LOW',
    score: 0,
    emoji: '📉',
    message: 'Score dropped below threshold',
    detectionType: SessionEventDetectionType.SCORE,
    detectionData: { score: -20, condition: 'LT' },
  },
  {
    id: randomUUID(),
    name: 'Rude language detected',
    eventCode: 'BC-RUDE',
    score: -20,
    emoji: '🙀',
    message: 'Avoid rude language',
    detectionType: SessionEventDetectionType.BINARY_CLASSIFIER,
    detectionData: { className: 'Rude' },
  },
];

const sharedScenarioMetadata = {
  prompt:
    'You are an AI roleplay assistant for counselor training. Stay fully in character as the client in a therapy session.',
  selectedLanguageIds: [1],
  experienceMode: ExperienceMode.FEEDBACK,
  responseLength: ScenarioResponseLength.VERY_BRIEF,
  timerMode: false,
  showScoreMeter: false,
  stateNames: [
    { stateId: '-1', name: 'State -1' },
    { stateId: '1', name: 'State 1' },
    { stateId: '2', name: 'State 2' },
    { stateId: '3', name: 'State 3' },
  ],
};

export const scenarios: ScenarioFixture[] = [
  {
    key: 'active-listening',
    title: 'Active Listening Basics',
    description:
      'Practice active listening with Alex, a young professional feeling overwhelmed.',
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Alex Johnson',
      age: 25,
      gender: 'male',
      profession: 'Software Engineer',
      currentLocation: 'Kochi, India',
      tone: 'Casual',
      openingStatements: [
        'I am not sure where to start...',
        'Everything feels like it is piling up.',
      ],
      characterProfileText:
        'Alex is a 25-year-old software engineer struggling with work-life balance.',
    },
  },
  {
    key: 'workplace-anxiety',
    title: 'Managing Workplace Anxiety',
    description:
      'Practice empathetic responses with Priya, who is experiencing anxiety at work.',
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Priya Nair',
      age: 29,
      gender: 'female',
      profession: 'Product Manager',
      currentLocation: 'Bengaluru, India',
      tone: 'Thoughtful',
      openingStatements: [
        'I have been feeling on edge at work lately.',
        'Even small tasks are starting to feel stressful.',
      ],
      characterProfileText:
        'Priya is a 29-year-old product manager experiencing anxiety due to workplace pressure.',
    },
  },
];

export const pathways: PathwayFixture[] = [
  {
    title: 'Counseling Fundamentals',
    description:
      'Introductory path covering active listening and emotional support.',
    scenarioKeys: ['active-listening', 'workplace-anxiety'],
  },
];

export const cases: CaseFixture[] = [
  {
    title: 'Early-Career Counseling',
    description:
      'Sample case covering common early-career client presentations.',
    scenarioKeys: ['active-listening', 'workplace-anxiety'],
  },
];

export const sessions: SessionFixture[] = [
  {
    scenarioKey: 'active-listening',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 78,
    durationMinutes: 12,
    transcript: [
      { from: 'client', content: 'I am not sure where to start...' },
      {
        from: 'counselor',
        content: 'Take your time. Whatever feels right to share first.',
      },
      {
        from: 'client',
        content: 'Work has been piling up and I am not sleeping well.',
      },
      {
        from: 'counselor',
        content: 'That sounds exhausting. How long has it been like this?',
      },
    ],
  },
  {
    scenarioKey: 'workplace-anxiety',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 64,
    durationMinutes: 9,
    transcript: [
      {
        from: 'client',
        content: 'I have been feeling on edge at work lately.',
      },
      {
        from: 'counselor',
        content: 'Tell me what that looks like for you day to day.',
      },
      {
        from: 'client',
        content: 'Even small tasks are starting to feel stressful.',
      },
      {
        from: 'counselor',
        content:
          'That sounds really hard. What feels most overwhelming right now?',
      },
    ],
  },
  {
    scenarioKey: 'active-listening',
    status: ScenarioSessionStatus.ACTIVE,
    eventStatus: ScenarioSessionEventStatus.IN_PROGRESS,
    durationMinutes: 0,
    transcript: [],
  },
];

export const badges: BadgeFixture[] = [
  {
    name: 'Simulation Starter',
    description: 'Complete your first 10 minutes of simulation practice.',
    category: BadgeCategory.SIMULATION_MINUTES,
    count: 10,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Consistent Start',
    description: 'Build a 3-day active streak.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 3,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Community Contributor',
    description: 'Leave 5 comments or reactions.',
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    count: 5,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Crowd Favorite',
    description: 'Receive 5 reactions from peers.',
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    count: 5,
    groupNames: [UserRole.LEARNER],
  },
];

export const defaults = {
  scenarioStatus: ScenarioStatus.ACTIVE,
  scenarioDifficulty: ScenarioDifficultyLevel.EASY,
  pathStatus: ScenarioPathStatus.ACTIVE,
  caseStatus: CaseStatus.ACTIVE,
  badgeStatus: BadgeStatus.ACTIVE,
  badgeVisibility: BadgeVisibilityType.PUBLIC,
  eventVisibility: SessionEventVisibilityType.ACTIVE,
  userStatus: UserStatus.ACTIVE,
};
