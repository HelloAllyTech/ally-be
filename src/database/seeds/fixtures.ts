import { randomUUID } from 'crypto';
import { UserRole } from '../../common/constants/user.constants';
import { UserStatus } from '../../user/constants/user-status.constants';
import { TenantStatus } from '../../tenant/entity/tenant.entity';
import {
  BadgeCategory,
  BadgeStatus,
  BadgeVisibilityType,
} from '../../badge/constants/badge.constants';
import {
  ExperienceMode,
  ScenarioDifficultyLevel,
  ScenarioStatus,
} from '../../learn/type/scenario.type';
import { ScenarioCategory } from '../../learn/enum/scenario-category.enum';
import { ScenarioPathStatus } from '../../scenario-path/type/scenario-paths.type';
import { CaseStatus } from '../../case/type/cases.type';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
  ScenarioSessionAbandonReason,
  ScenarioSessionEndReason,
} from '../../learn/enum/scenario-session-status.enum';
import { SessionEventDetectionType } from '../../session-event/enum/session-event-detection.enum';
import { SessionEventVisibilityType } from '../../session-event/enum/session-event-visibility-type.enum';
import { BehaviorInstructionCategory } from '../../learn/enum/behavior-instruction.enum';
import { ReviewStatus } from '../../review/type/review.type';
import { TENANT_CODE, TENANT_NAME, ADMIN_EMAIL } from './config';

export interface TenantFixture {
  code: string;
  name: string;
  description: string;
  isTestOrganization?: boolean;
  status?: TenantStatus;
}

export interface UserFixture {
  email: string;
  name: string;
  roles: UserRole[];
  // Tenant this user belongs to (User.tenantId). Must match a TenantFixture.code.
  tenantCode: string;
  // Extra tenants a MULTI_TENANT_ADMIN also administers (admin_tenants rows),
  // beyond their home tenantCode.
  additionalAdminTenantCodes?: string[];
  status?: UserStatus;
  // False = account created in bulk, never completed onboarding.
  profileCompleted?: boolean;
  termsAndAgreementApproved?: boolean;
  // True = an admin suspended this specific account (suspendedBy/At stamped
  // on the seed admin), distinct from the tenant itself being suspended.
  suspended?: boolean;
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

export interface ScenarioBehaviorInstructionFixture {
  category: BehaviorInstructionCategory;
  behaviorNames: string[];
  stateInstructions: Array<{ stateId: string; instruction: string }>;
}

export interface ScenarioTranslationFixture {
  openingStatements?: string[];
  characterProfileText?: string;
  // Also required for the language switcher: SCENARIO_SESSION_TRANSLATABLE_FIELDS
  // and the admin translation tabs read these, not just openingStatements.
  title?: string;
  description?: string;
  reminders?: string[];
}

export interface ScenarioFixture {
  key: string;
  title: string;
  description: string;
  competencyName: string;
  coverImageUrl: string;
  metadata: Record<string, any>;
  behaviorInstructions: ScenarioBehaviorInstructionFixture[];
  status?: ScenarioStatus;
  difficultyLevel?: ScenarioDifficultyLevel;
  category?: ScenarioCategory;
  partnerOrgName?: string;
  triggerWarningNames?: string[];
  // Keyed by Languages.value (e.g. 'hi-IN').
  translationsByLanguage?: Record<string, ScenarioTranslationFixture>;
}

export interface PathwayFixture {
  title: string;
  description: string;
  scenarioKeys: string[];
  status?: ScenarioPathStatus;
}

export interface BadgeFixture {
  name: string;
  description: string;
  category: BadgeCategory;
  count: number;
  groupNames: UserRole[];
  status?: BadgeStatus;
}

export interface EarnedBadgeFixture {
  email: string;
  badgeName: string;
  earnedDaysAgo: number;
  viewed?: boolean;
}

export interface CaseFixture {
  title: string;
  description: string;
  scenarioKeys: string[];
  status?: CaseStatus;
}

export interface SessionFixture {
  // Stable identifier appended to `seed-room-` to form roomId. Required so
  // multiple sessions can share a scenario+status without colliding, and so
  // review fixtures can pin to a specific session by room id.
  roomKey: string;
  scenarioKey: string;
  // Defaults to 'learner@example.com' (the original single-tenant fixture set).
  counselorEmail?: string;
  status: ScenarioSessionStatus;
  eventStatus: ScenarioSessionEventStatus;
  score?: number;
  durationMinutes: number;
  transcript: Array<{ from: 'counselor' | 'client'; content: string }>;
  events?: Array<{
    eventCode: string;
    occurredAtTurnIndex: number;
  }>;
  // Only meaningful when status/eventStatus is ABANDONED — why the session
  // was never closed out (see ScenarioSessionAbandonReason's doc comment).
  abandonedReason?: ScenarioSessionAbandonReason;
  // Only meaningful for a normally-ENDED/COMPLETED session force-exited by
  // the stall watchdog rather than a clean finish.
  endReason?: ScenarioSessionEndReason;
}

export interface SimulationCreditsFixture {
  creditLimit: number;
  consumedCredits: number;
}

export interface ReviewCommentReplyFixture {
  authorEmail: string;
  content: string;
  reactions?: Array<{ email: string; reaction: string }>;
}

export interface ReviewCommentFixture {
  authorEmail: string;
  content: string;
  reactions?: Array<{ email: string; reaction: string }>;
  replies?: ReviewCommentReplyFixture[];
  // Exercises BaseReviewComment.hidden — a moderated-out comment that must
  // exist in the DB but never surface in the normal feed.
  hidden?: boolean;
}

export interface ReviewThreadFixture {
  // 'general' = review-level thread (messageId/selection null).
  // Otherwise pins the thread to a specific transcript turn.
  turnIndex: number | 'general';
  selection?: { startIndex: number; endIndex: number };
  authorEmail: string;
  comments: ReviewCommentFixture[];
}

export interface ReviewFixture {
  // Matches the SessionFixture this review is attached to.
  sessionRoomId: string;
  // learner@example.com authored the sessions, so the review owner is the learner.
  authorEmail: string;
  note?: string;
  reactions?: Array<{ email: string; reaction: string }>;
  readByEmails?: string[];
  threads: ReviewThreadFixture[];
  // Defaults to IN_REVIEW. HIDDEN exercises the moderated-out review state —
  // it must exist in the DB but never surface in the normal feed.
  status?: ReviewStatus;
}

// Four tenants spanning the shapes a real deployment sees: the internal/demo
// org every other fixture defaults to, two active paying customers of
// different sizes, and one suspended for non-payment (an edge case a real
// platform accumulates within months of onboarding its first cohort).
export const tenants: TenantFixture[] = [
  {
    code: TENANT_CODE,
    name: TENANT_NAME,
    description:
      'Internal Ally workspace used for demos, QA, and platform-team training content.',
    isTestOrganization: true,
  },
  {
    code: 'northwind-behavioral-health',
    name: 'Northwind Behavioral Health',
    description:
      'Enterprise behavioral health network across 12 clinics; onboarded as an early design partner.',
    status: TenantStatus.ACTIVE,
  },
  {
    code: 'riverside-wellness-center',
    name: 'Riverside Wellness Center',
    description:
      'Mid-size community counseling center running a cohort-based counselor certification program.',
    status: TenantStatus.ACTIVE,
  },
  {
    code: 'brightpath-counseling',
    name: 'Bright Path Counseling',
    description:
      'Small private practice group; access suspended pending an overdue renewal invoice.',
    status: TenantStatus.SUSPENDED,
  },
];

export const users: UserFixture[] = [
  {
    email: ADMIN_EMAIL,
    name: 'Meera Kulkarni',
    roles: [UserRole.SUPER_ADMIN],
    tenantCode: TENANT_CODE,
  },
  {
    email: 'arjun.rao@helloally.ai',
    name: 'Arjun Rao',
    roles: [UserRole.SUPER_DUPER_ADMIN],
    tenantCode: TENANT_CODE,
  },
  {
    email: 'org-admin@example.com',
    name: 'Divya Shah',
    roles: [UserRole.ADMIN],
    tenantCode: TENANT_CODE,
  },
  {
    email: 'learner@example.com',
    name: 'Kabir Singh',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: TENANT_CODE,
  },
  {
    email: 'multi-tenant-admin1@example.com',
    name: 'Elena Petrova',
    roles: [UserRole.MULTI_TENANT_ADMIN],
    tenantCode: TENANT_CODE,
    additionalAdminTenantCodes: [
      'northwind-behavioral-health',
      'riverside-wellness-center',
      'brightpath-counseling',
    ],
  },
  {
    email: 'reviewer@example.com',
    name: 'Karthik Iyer',
    roles: [UserRole.SIMULATION_REVIEWER],
    tenantCode: TENANT_CODE,
  },

  // Northwind Behavioral Health — enterprise customer
  {
    email: 'sarah.thompson@northwindbh.org',
    name: 'Sarah Thompson',
    roles: [UserRole.MULTI_TENANT_ADMIN],
    tenantCode: 'northwind-behavioral-health',
    additionalAdminTenantCodes: ['riverside-wellness-center'],
  },
  {
    email: 'james.okafor@northwindbh.org',
    name: 'James Okafor',
    roles: [UserRole.ADMIN],
    tenantCode: 'northwind-behavioral-health',
  },
  {
    email: 'priya.nair@northwindbh.org',
    name: 'Priya Nair',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'northwind-behavioral-health',
  },
  {
    email: 'daniel.reyes@northwindbh.org',
    name: 'Daniel Reyes',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'northwind-behavioral-health',
  },
  {
    email: 'fatima.siddiqui@northwindbh.org',
    name: 'Fatima Siddiqui',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'northwind-behavioral-health',
    // Just hired; hasn't completed the first-login profile prompt yet.
    profileCompleted: false,
  },
  {
    email: 'wei.zhang@northwindbh.org',
    name: 'Wei Zhang',
    roles: [UserRole.SIMULATION_REVIEWER],
    tenantCode: 'northwind-behavioral-health',
  },
  {
    email: 'marcus.olawale@northwindbh.org',
    name: 'Marcus Olawale',
    roles: [UserRole.LEARNER],
    tenantCode: 'northwind-behavioral-health',
    // Bulk-imported by an org admin ahead of a training cohort; has never logged in.
    profileCompleted: false,
    termsAndAgreementApproved: false,
  },
  {
    email: 'grace.kim@gmail.com',
    name: 'Grace Kim',
    roles: [UserRole.CLIENT],
    tenantCode: 'northwind-behavioral-health',
  },

  // Riverside Wellness Center — mid-size customer
  {
    email: 'omar.hassan@riversidewellness.io',
    name: 'Omar Hassan',
    roles: [UserRole.ADMIN],
    tenantCode: 'riverside-wellness-center',
  },
  {
    email: 'lucia.fernandez@riversidewellness.io',
    name: 'Lucía Fernández',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'riverside-wellness-center',
  },
  {
    email: 'tobias.becker@riversidewellness.io',
    name: 'Tobias Becker',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'riverside-wellness-center',
  },
  {
    email: 'aisha.bello@riversidewellness.io',
    name: 'Aisha Bello',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'riverside-wellness-center',
  },
  {
    email: 'yuki.tanaka@riversidewellness.io',
    name: 'Yuki Tanaka',
    roles: [UserRole.SCRIBE_REVIEWER],
    tenantCode: 'riverside-wellness-center',
  },

  // Bright Path Counseling — small practice, tenant suspended
  {
    email: 'oliver.bennett@brightpathcounseling.net',
    name: 'Oliver Bennett',
    roles: [UserRole.ADMIN],
    tenantCode: 'brightpath-counseling',
  },
  {
    email: 'simran.kaur@brightpathcounseling.net',
    name: 'Simran Kaur',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'brightpath-counseling',
  },
  {
    email: 'ines.moreno@brightpathcounseling.net',
    name: 'Inés Moreno',
    roles: [UserRole.LEARNER, UserRole.COUNSELOR],
    tenantCode: 'brightpath-counseling',
    // Individually suspended before the org-wide suspension (a separate,
    // earlier conduct issue) — exercises suspendedBy/suspendedAt directly.
    suspended: true,
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

export const SEED_SCENARIO_PROMPT = `You are an AI roleplay assistant for counselor training. In this simulation, you must act ONLY as the client in a therapy session. Stay fully in character, provide realistic dialogue, and do not switch roles unless explicitly instructed.

Important Instructions:
- Prefer first-person phrasing (e.g., "I feel…", "I've been struggling with…").
- Allow the counselor to guide the conversation.
- If the counselor is silent or open-ended, share one thought, feeling, or small story, then stop.
- Maintain consistency with your life history but allow natural variation in tone and detail.
- Respond naturally, as a real client would.
- Keep answers concise (2–6 sentences), unless a longer response is natural.
- Reveal information gradually, not all at once.
- Start with few details and open up more as the counsellor asks questions.
- Show authentic emotions and natural hesitations.
- Do not give therapy advice or act as the counselor.
- If sensitive topics arise, respond realistically but without graphic detail.
- Keep each reply under ~120 words.`;

// Curated cover image library — leads with mental-health-themed photography
// (therapy / quiet introspection / grief / hope) so the in-UI image picker
// surfaces relevant defaults for new scenarios. Named constants let scenario
// fixtures reference library entries explicitly instead of duplicating URLs.
export const COVER_IMG_QUIET_REFLECTION =
  'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80';
export const COVER_IMG_GRIEF_COMFORT =
  'https://images.unsplash.com/photo-1573497019418-b400bb3ab074?w=800&q=80';
export const COVER_IMG_THERAPY_SESSION =
  'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&q=80';
export const COVER_IMG_MINDFUL_PAUSE =
  'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80';
export const COVER_IMG_HOPEFUL_SUNRISE =
  'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80';
export const COVER_IMG_SUPPORTIVE_HANDS =
  'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800&q=80';
export const COVER_IMG_JOURNALING =
  'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800&q=80';
export const COVER_IMG_NATURE_WALK =
  'https://images.unsplash.com/photo-1476611338391-6f395a0dd82e?w=800&q=80';
export const COVER_IMG_GROUP_SUPPORT =
  'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=800&q=80';
export const COVER_IMG_LISTENING_EAR =
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&q=80';
export const COVER_IMG_RESTFUL_BEDROOM =
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&q=80';
export const COVER_IMG_CALM_LANDSCAPE =
  'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=800&q=80';

export const scenarioCoverImages: string[] = [
  COVER_IMG_QUIET_REFLECTION,
  COVER_IMG_GRIEF_COMFORT,
  COVER_IMG_THERAPY_SESSION,
  COVER_IMG_MINDFUL_PAUSE,
  COVER_IMG_HOPEFUL_SUNRISE,
  COVER_IMG_SUPPORTIVE_HANDS,
  COVER_IMG_JOURNALING,
  COVER_IMG_NATURE_WALK,
  COVER_IMG_GROUP_SUPPORT,
  COVER_IMG_LISTENING_EAR,
  COVER_IMG_RESTFUL_BEDROOM,
  COVER_IMG_CALM_LANDSCAPE,
];

const sharedScenarioMetadata = {
  prompt: SEED_SCENARIO_PROMPT,
  selectedLanguageIds: [1],
  experienceMode: ExperienceMode.FEEDBACK,
  timerMode: false,
  showScoreMeter: false,
  linguisticStyleSamples: {
    '1': [
      'I just want things to feel a bit lighter, you know?',
      "It's like my mind keeps running and I can't slow it down.",
    ],
  },
  stateNames: [
    { stateId: '-1', name: 'State -1' },
    { stateId: '1', name: 'State 1' },
    { stateId: '2', name: 'State 2' },
    { stateId: '3', name: 'State 3' },
  ],
};

export const scenarios: ScenarioFixture[] = [
  {
    key: 'coping-with-depression',
    title: 'Coping With Persistent Low Mood',
    description:
      'Practice supporting Anjali, a young adult experiencing persistent sadness, low energy, and loss of interest in things she used to enjoy.',
    competencyName: 'Empathy, Warmth & Genuineness',
    coverImageUrl: COVER_IMG_QUIET_REFLECTION,
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Anjali Verma',
      age: 24,
      gender: 'female',
      profession: 'Graduate Student',
      currentLocation: 'Pune, India',
      openingStatements: [
        'I have not really felt like myself in a long time.',
        'It is like nothing brings me joy anymore.',
      ],
      characterProfileText:
        'Anjali is a 24-year-old graduate student experiencing persistent low mood, fatigue, and anhedonia over the past several months. She finds it hard to articulate her feelings and tends to minimise them.',
    },
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Grief and bereavement'],
    translationsByLanguage: {
      'hi-IN': {
        title: 'लगातार उदासी से निपटना',
        description:
          'अंजलि की मदद करने का अभ्यास करें, जो लगातार उदासी, कम ऊर्जा और रुचि की कमी का अनुभव कर रही है।',
        openingStatements: [
          'मुझे लंबे समय से खुद जैसा महसूस नहीं हुआ है।',
          'ऐसा लगता है जैसे अब किसी चीज़ में खुशी नहीं मिलती।',
        ],
        characterProfileText:
          'अंजलि एक 24 वर्षीय स्नातक छात्रा है जो पिछले कई महीनों से लगातार उदासी, थकान और किसी भी चीज़ में रुचि न होने का अनुभव कर रही है।',
        reminders: [
          'सहानुभूति के साथ सुनें',
          'समाधान देने में जल्दबाजी न करें',
        ],
      },
      'mr-IN': {
        title: 'सतत उदासीनतेला सामोरे जाणे',
        description:
          'अंजलीला मदत करण्याचा सराव करा, जी सतत उदासीनता, कमी ऊर्जा आणि आवडीचा अभाव अनुभवत आहे.',
        openingStatements: [
          'माझ्यात बराच काळ आधीसारखं वाटलेलं नाही.',
          'असं वाटतं की आता कशातच आनंद मिळत नाही.',
        ],
      },
      'ta-IN': {
        title: 'தொடர்ச்சியான மனச்சோர்வை சமாளித்தல்',
        description:
          'தொடர்ச்சியான மனச்சோர்வு மற்றும் ஆர்வமின்மையை அனுபவிக்கும் அஞ்சலிக்கு உதவும் பயிற்சி.',
        openingStatements: [
          'நான் நீண்ட காலமாக என்னைப் போலவே உணரவில்லை.',
          'எதிலும் மகிழ்ச்சி கிடைப்பது போல் தெரியவில்லை.',
        ],
      },
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Demonstrates warmth and genuineness',
          'Validates emotional experience',
          'Uses open-ended questions',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Create a safe space. Gently invite the client to share at her own pace and validate how heavy this has felt.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          "Critical of client's concerns",
          'Dismissive of concerns',
          'Imposes personal beliefs',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Avoid phrases like "cheer up" or "it could be worse". Do not rush her toward solutions.',
          },
        ],
      },
    ],
  },
  {
    key: 'processing-grief',
    title: 'Supporting a Client Through Grief',
    description:
      'Practice sitting with Rohan, who recently lost his mother and is struggling with waves of sadness, guilt, and difficulty sleeping.',
    competencyName: 'Empathy, Warmth & Genuineness',
    coverImageUrl: COVER_IMG_GRIEF_COMFORT,
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Rohan Mehta',
      age: 38,
      gender: 'male',
      profession: 'Teacher',
      currentLocation: 'Jaipur, India',
      openingStatements: [
        'My mother passed away six weeks ago.',
        'I keep replaying the last few days in my head.',
      ],
      characterProfileText:
        'Rohan is a 38-year-old school teacher whose mother passed away six weeks ago after a brief illness. He carries guilt about not being present in her final hours and is experiencing intrusive thoughts and disrupted sleep.',
    },
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Grief and bereavement'],
    translationsByLanguage: {
      'hi-IN': {
        title: 'शोक से गुजर रहे ग्राहक का साथ देना',
        description:
          'रोहन का साथ देने का अभ्यास करें, जिनकी माँ का हाल ही में निधन हो गया है।',
        openingStatements: [
          'मेरी माँ का छह हफ्ते पहले निधन हो गया।',
          'मैं बार-बार आखिरी दिनों को याद करता रहता हूँ।',
        ],
        characterProfileText:
          'रोहन एक 38 वर्षीय शिक्षक है जिनकी माँ की छह सप्ताह पहले एक छोटी बीमारी के बाद मृत्यु हो गई। वह अपराध बोध और अनिद्रा से जूझ रहे हैं।',
      },
      'mr-IN': {
        title: 'दुःखातून जाणाऱ्या क्लायंटला साथ देणे',
        description:
          'रोहनला साथ देण्याचा सराव करा, ज्यांच्या आईचे नुकतेच निधन झाले आहे.',
        openingStatements: [
          'माझ्या आईचे सहा आठवड्यांपूर्वी निधन झाले.',
          'मी वारंवार शेवटच्या दिवसांचा विचार करत राहतो.',
        ],
      },
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Demonstrates warmth and genuineness',
          'Shows consistent concern and care',
          'Is warm, friendly, and genuine throughout roleplay',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Allow space for tears and pauses. Acknowledge the loss explicitly rather than skirting around it.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Dismissive of concerns',
          'Gives premature advice',
          "Critical of client's concerns",
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Do not say "they are in a better place" or push him to "move on". Avoid timelines for grief.',
          },
        ],
      },
    ],
  },
  {
    key: 'financial-stress-anxiety',
    title: 'Supporting a Client Through Financial Anxiety',
    description:
      'Practice sitting with Imran, a shop owner whose business debt is driving irritability, poor sleep, and reluctance to talk about money directly.',
    competencyName: 'Strengthen Coping Strategies',
    coverImageUrl: COVER_IMG_MINDFUL_PAUSE,
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Financial hardship'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Imran Qureshi',
      age: 45,
      gender: 'male',
      profession: 'Small Business Owner',
      currentLocation: 'Lucknow, India',
      openingStatements: [
        'Business has not been good this year and I have taken on more debt than I would like.',
        'I do not really talk about money with anyone, not even my wife.',
      ],
      characterProfileText:
        'Imran is a 45-year-old shop owner whose business took on heavy debt during a slow year. He is presenting with irritability, sleep disturbance, and reluctance to discuss finances directly.',
    },
    translationsByLanguage: {
      'hi-IN': {
        title: 'वित्तीय चिंता से जूझ रहे ग्राहक का साथ देना',
        description:
          'इमरान का साथ देने का अभ्यास करें, जिनके व्यापार का कर्ज़ उन्हें चिड़चिड़ा और चिंतित बना रहा है।',
        openingStatements: [
          'इस साल व्यापार ठीक नहीं चला और मैंने जितना चाहता था उससे ज़्यादा कर्ज़ ले लिया है।',
          'मैं पैसों के बारे में किसी से बात नहीं करता, यहाँ तक कि अपनी पत्नी से भी नहीं।',
        ],
      },
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Uses open-ended questions',
          'Encourages elaboration ("Tell me more…")',
          'Matches rhythm and pacing to client',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Let Imran set the pace on financial specifics. Focus first on the stress and its effect on sleep/mood before probing numbers.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: ['Gives premature advice', 'Overuse of "why" questions'],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Do not jump to budgeting advice. Avoid repeated "why" questions about the debt itself.',
          },
        ],
      },
    ],
  },
  {
    key: 'risk-assessment-safety-planning',
    title: 'Assessing Risk and Building a Safety Plan',
    description:
      'Practice a structured risk assessment with Naomi, a first-year student experiencing rising isolation and passive thoughts of self-harm.',
    competencyName: 'Assessment of Harm & Response Planning',
    coverImageUrl: COVER_IMG_SUPPORTIVE_HANDS,
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Self-harm', 'Suicidal ideation'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Naomi Fernandes',
      age: 19,
      gender: 'non-binary',
      profession: 'Undergraduate Student',
      currentLocation: 'Goa, India',
      openingStatements: [
        'I have been feeling really cut off from everyone lately.',
        'Sometimes I think it would just be easier if I was not around.',
      ],
      characterProfileText:
        'Naomi is a 19-year-old first-year college student navigating questions about their gender identity while facing an unsupportive family environment, with rising social anxiety, isolation, and passive thoughts of self-harm.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Asks directly about harm to self/others/from others',
          'Assesses intent, means, prior attempts',
          'Develops collaborative safety plan',
        ],
        stateInstructions: [
          {
            stateId: '2',
            instruction:
              'Once risk language surfaces, ask directly and calmly about intent, means, and any prior attempts before moving to safety planning.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Does not ask about harm to self or others',
          'Encourages secrecy about harm, promises not to share',
        ],
        stateInstructions: [
          {
            stateId: '2',
            instruction:
              'Never promise unconditional confidentiality once risk is disclosed, and never let the disclosure pass without following up.',
          },
        ],
      },
    ],
  },
  {
    key: 'confidentiality-conversation',
    title: 'Explaining Confidentiality to a Hesitant Client',
    description:
      'Practice opening a first session with Devika, who is hesitant to speak candidly because she is worried about workplace stigma if anything gets back to her employer.',
    competencyName: 'Explain & Promote Confidentiality',
    coverImageUrl: COVER_IMG_LISTENING_EAR,
    status: ScenarioStatus.ACTIVE,
    difficultyLevel: ScenarioDifficultyLevel.EASY,
    category: ScenarioCategory.DEMO,
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Devika Pillai',
      age: 29,
      gender: 'female',
      profession: 'Software Engineer',
      currentLocation: 'Bengaluru, India',
      openingStatements: [
        'My company set this up as a benefit, so I am a little worried about who actually sees what I say.',
        'I want to talk about work stress, but I need to know this stays private first.',
      ],
      characterProfileText:
        'Devika is a 29-year-old software engineer presenting with escalating work-related anxiety and panic episodes before client calls. She is hesitant to disclose fully until confidentiality is clearly explained.',
    },
    translationsByLanguage: {
      'hi-IN': {
        title: 'हिचकिचाते ग्राहक को गोपनीयता समझाना',
        description:
          'देविका के साथ पहला सत्र शुरू करने का अभ्यास करें, जो कार्यस्थल पर बदनामी के डर से खुलकर बात करने से हिचकिचा रही हैं।',
        openingStatements: [
          'मेरी कंपनी ने इसे एक सुविधा के रूप में शुरू किया है, इसलिए मुझे थोड़ी चिंता है कि मैं जो कहती हूँ उसे कौन देखता है।',
          'मैं काम के तनाव के बारे में बात करना चाहती हूँ, लेकिन पहले मुझे यह जानना है कि यह निजी रहेगा।',
        ],
      },
      'ta-IN': {
        title: 'தயங்கும் வாடிக்கையாளருக்கு ரகசியத்தன்மையை விளக்குதல்',
        description:
          'பணியிட களங்கத்தை பற்றி கவலைப்படும் தேவிகாவுடன் முதல் அமர்வைத் தொடங்கும் பயிற்சி.',
        openingStatements: [
          'எனது நிறுவனம் இதை ஒரு நலனாக அமைத்துள்ளது, எனவே நான் சொல்வதை யார் பார்க்கிறார்கள் என்று சற்று கவலைப்படுகிறேன்.',
          'நான் வேலை மன அழுத்தத்தைப் பற்றி பேச விரும்புகிறேன், ஆனால் இது தனிப்பட்டதாக இருக்கும் என்பதை முதலில் அறிய வேண்டும்.',
        ],
      },
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Clearly explains confidentiality',
          'Explains limits (harm to self/others/from others)',
          'Addresses any questions/concerns about confidentiality',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Lead with a clear, plain-language explanation of confidentiality and its limits before asking Devika to disclose anything substantive.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Describes confidentiality inaccurately',
          'Promises full confidentiality without exceptions',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Never promise absolute confidentiality — always name the safety-related exceptions.',
          },
        ],
      },
    ],
  },
  {
    key: 'retirement-identity-loss',
    title: 'Navigating Identity Loss After Retirement',
    description:
      'Practice supporting Suresh, a recent retiree struggling with a loss of purpose, mild alcohol use, and friction with his adult children — built with Northwind Behavioral Health for their transitions-in-aging program.',
    competencyName: 'Collaborative Goal Setting',
    coverImageUrl: COVER_IMG_NATURE_WALK,
    category: ScenarioCategory.PARTNER_SIM,
    partnerOrgName: 'Northwind Behavioral Health',
    triggerWarningNames: ['Substance use', 'Domestic conflict'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Suresh Bhandari',
      age: 61,
      gender: 'male',
      profession: 'Retired Bank Manager',
      currentLocation: 'Nagpur, India',
      openingStatements: [
        'I retired eight months ago and I still do not know what to do with myself.',
        'My kids think I drink too much now. Maybe they are right, I do not know.',
      ],
      characterProfileText:
        'Suresh is a 61-year-old recent retiree struggling with a loss of identity and purpose, mild alcohol use as a coping mechanism, and friction with his adult children about his day-to-day habits.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Asks about client goals and expectations',
          'Adjusts recommendations collaboratively',
          'Brainstorms alternatives collaboratively',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Help Suresh articulate what a meaningful day looks like now, rather than prescribing activities for him.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Dictates goals',
          'Dismisses client goals without explanation',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Do not hand him a routine to follow. Do not dismiss the drinking as a side issue — but let him raise it before confronting it head-on.',
          },
        ],
      },
    ],
  },
  {
    key: 'workplace-burnout-checkin',
    title: 'Workplace Burnout Check-In',
    description:
      'A shorter-format check-in with Meher, a marketing manager showing early burnout signs — still being refined with the content team before publishing.',
    competencyName: 'Rapport Building & Self-Disclosure',
    coverImageUrl: COVER_IMG_JOURNALING,
    status: ScenarioStatus.DRAFT,
    difficultyLevel: ScenarioDifficultyLevel.EASY,
    category: ScenarioCategory.OTHER,
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Meher Chandran',
      age: 33,
      gender: 'female',
      profession: 'Marketing Manager',
      currentLocation: 'Chennai, India',
      openingStatements: [
        'I have been running on empty for a couple of months now.',
        'I still get everything done, I just do not feel anything about it anymore.',
      ],
      characterProfileText:
        'Meher is a 33-year-old marketing manager showing early signs of burnout: emotional flatness despite maintained output, cynicism about her work, and reduced sense of accomplishment.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Uses open-ended questions',
          'Summarises and paraphrases',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Draft instruction — refine once the content team finalises the burnout-specific checklist.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: ['Gives premature advice'],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Draft instruction — avoid solutioning before the checklist ships.',
          },
        ],
      },
    ],
  },
  {
    key: 'family-conflict-mediation',
    title: 'Navigating Family Conflict Around Care Decisions',
    description:
      'Practice a three-way dynamic in spirit — sit with Farah, who is caught between siblings who disagree sharply about how to care for their aging father.',
    competencyName: 'Involvement of Family & Significant Others',
    coverImageUrl: COVER_IMG_GROUP_SUPPORT,
    difficultyLevel: ScenarioDifficultyLevel.HARD,
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Domestic conflict'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Farah Al-Sayed',
      age: 52,
      gender: 'female',
      profession: 'Homemaker',
      currentLocation: 'Hyderabad, India',
      openingStatements: [
        'My brothers and I cannot agree on what is best for my father anymore.',
        'Every phone call turns into an argument and I am the one stuck in the middle.',
      ],
      characterProfileText:
        'Farah is a 52-year-old homemaker acting as the primary point of contact between her siblings over their aging father’s care, absorbing conflicting opinions and feeling responsible for keeping the peace.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Explores family/social network views',
          'Checks and clarifies understanding',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Help Farah separate her own needs from the role of go-between she has taken on with her siblings.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: ['Dismisses emotions', 'Becomes defensive'],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Do not take a side on the family disagreement or dismiss how exhausting the mediator role has become for her.',
          },
        ],
      },
    ],
  },

  // Status-lifecycle variety — every scenario until now was ACTIVE or DRAFT;
  // COMING_SOON and ARCHIVED were never exercised. Neither goes into any
  // case/pathway/track.
  {
    key: 'crisis-call-de-escalation',
    title: 'Holding a Crisis Call Steady',
    description:
      'Practice staying grounded with a caller in acute distress, assessing for immediate risk while keeping the conversation collaborative.',
    competencyName: 'Assessment of Harm & Response Planning',
    coverImageUrl: COVER_IMG_SUPPORTIVE_HANDS,
    status: ScenarioStatus.COMING_SOON,
    difficultyLevel: ScenarioDifficultyLevel.HARD,
    category: ScenarioCategory.ORIGINALS,
    triggerWarningNames: ['Suicidal ideation'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Naomi Fernandes',
      age: 29,
      gender: 'female',
      profession: 'Freelance Designer',
      currentLocation: 'Goa, India',
      openingStatements: [
        'I did not think I would actually call this number.',
        'I am not okay right now.',
      ],
      characterProfileText:
        'Naomi is calling a crisis line during an acute episode of distress. She is ambivalent about being helped and needs to feel heard before she can engage with safety planning.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Asks directly about harm to self/others/from others',
          'Assesses intent, means, prior attempts',
          'Develops collaborative safety plan',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Stay calm and collaborative. Ask directly about safety once trust is established.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Does not ask about harm to self or others',
          'Expresses shock or disbelief in response to disclosure',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Do not react with alarm to disclosures — it can shut the caller down.',
          },
        ],
      },
    ],
  },
  {
    key: 'substance-use-first-conversation',
    title: 'First Conversation About Drinking',
    description:
      'Practice a first, low-pressure conversation with a client who is starting to question their own drinking, without pushing them toward a label.',
    competencyName: 'Strengthen Coping Strategies',
    coverImageUrl: COVER_IMG_CALM_LANDSCAPE,
    status: ScenarioStatus.ARCHIVED,
    difficultyLevel: ScenarioDifficultyLevel.MEDIUM,
    category: ScenarioCategory.OTHER,
    triggerWarningNames: ['Substance use'],
    metadata: {
      ...sharedScenarioMetadata,
      name: 'Vikram Desai',
      age: 41,
      gender: 'male',
      profession: 'Sales Manager',
      currentLocation: 'Mumbai, India',
      openingStatements: [
        'I do not think I have a problem, exactly.',
        'But my wife has started saying something about it.',
      ],
      characterProfileText:
        'Vikram drinks most evenings to unwind and is beginning to notice it costing him at home, but is not ready to call it a problem.',
    },
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Asks about past/current coping',
          'Praises positive coping strategies',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Explore what drinking is currently doing for him before discussing change.',
          },
        ],
      },
      {
        category: BehaviorInstructionCategory.SHOULD_NOT_DO,
        behaviorNames: [
          'Dismisses coping strategies',
          'Judges past problem-solving attempts',
        ],
        stateInstructions: [
          {
            stateId: '1',
            instruction:
              'Avoid labelling him as having "a problem" before he does.',
          },
        ],
      },
    ],
  },
];

// Pathways (scenario_paths) and Cases (cases) are schema-identical ordered
// bundles of roleplays — this is not an accident of these fixtures, it is
// the state of the product (case_items/scenario_path_items are byte-for-byte
// the same entity modulo the FK name). The only differences are structural:
// a Track can embed a Case (track_items.case_id) but not a Pathway, and only
// Cases support cohort restrictions (case_cohort_restrictions). Pathways are
// the older primitive and their eventual sunset is an open decision — see
// docs/courses-certification-plan.md §2. The fixtures below deliberately
// give each primitive distinct membership so the two surfaces don't look
// like a rendering bug of one another; "Mood and Grief Presentations" below
// is the case the seeded track ("New Counselor Foundations") already embeds
// — that embedding is the one difference that's actually visible today.
export const pathways: PathwayFixture[] = [
  {
    title: 'Mental Health Counseling Fundamentals',
    description:
      'Introductory path covering core mental health presentations: low mood and grief.',
    scenarioKeys: ['coping-with-depression', 'processing-grief'],
  },
  {
    title: 'Risk, Safety & Confidentiality Essentials',
    description:
      'Covers the two conversations every new counselor needs before seeing real clients: explaining confidentiality up front, and assessing risk when it surfaces mid-session.',
    scenarioKeys: [
      'confidentiality-conversation',
      'risk-assessment-safety-planning',
    ],
  },
  {
    title: 'Advanced Practice: Complex Presentations',
    description:
      'A three-scenario progression through harder, multi-layered presentations for counselors past the fundamentals.',
    scenarioKeys: [
      'retirement-identity-loss',
      'family-conflict-mediation',
      'financial-stress-anxiety',
    ],
  },
  {
    title: 'Legacy: Intro to Counseling Basics',
    description:
      'Retired introductory path, superseded by "Mental Health Counseling Fundamentals" — kept for historical reference.',
    scenarioKeys: ['confidentiality-conversation', 'coping-with-depression'],
    status: ScenarioPathStatus.ARCHIVED,
  },
];

export const cases: CaseFixture[] = [
  {
    title: 'Mood and Grief Presentations',
    description:
      'Two of the presentations a new counselor sees most often in the first month: persistent low mood and acute grief.',
    scenarioKeys: ['coping-with-depression', 'processing-grief'],
  },
  {
    title: 'Risk and Safety Fundamentals',
    description:
      'Pairs the confidentiality conversation every intake needs with a full risk assessment and safety-planning walkthrough.',
    scenarioKeys: [
      'confidentiality-conversation',
      'risk-assessment-safety-planning',
    ],
  },
  {
    title: 'Financial Stress & Life Transitions',
    description:
      'Draft case pairing financial-anxiety and retirement-identity presentations — still being sequenced before publishing.',
    scenarioKeys: ['financial-stress-anxiety', 'retirement-identity-loss'],
    status: CaseStatus.DRAFT,
  },
];

export const sessions: SessionFixture[] = [
  {
    roomKey: 'coping-with-depression-ended',
    scenarioKey: 'coping-with-depression',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 78,
    durationMinutes: 14,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Anjali, thanks for coming in today. Where would you like to begin?',
      },
      {
        from: 'client',
        content:
          'I am not really sure. I have not felt like myself in a long time.',
      },
      {
        from: 'counselor',
        content:
          'Take your time. Whatever feels right to share first — there is no wrong place to begin.',
      },
      {
        from: 'client',
        content:
          'Most days I just feel heavy. Like even getting out of bed takes everything I have.',
      },
      {
        from: 'counselor',
        content:
          'That sounds really heavy to carry. How long has it been feeling this way?',
      },
      {
        from: 'client',
        content:
          'Maybe five or six months now. It started slowly and then it just... stayed.',
      },
      {
        from: 'counselor',
        content:
          'That must be hard for you. Living with it for that long, day after day.',
      },
      {
        from: 'client',
        content:
          'Yeah. I used to love painting and going for walks but I have not touched any of it in months.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like the things that used to bring you joy have started to feel out of reach. What is that like for you?',
      },
      {
        from: 'client',
        content:
          'Lonely, mostly. I see my old self in those things and I do not recognise her anymore.',
      },
      {
        from: 'counselor',
        content:
          'Thank you for trusting me with that. Not recognising yourself — that is such a painful place to be. I want to make sure I really understand. Can you tell me more?',
      },
      { from: 'client', content: 'Yeah. I think I would like that.' },
    ],
    events: [
      { eventCode: 'SS-LISTEN', occurredAtTurnIndex: 6 },
      { eventCode: 'SS-LISTEN', occurredAtTurnIndex: 10 },
    ],
  },
  {
    roomKey: 'processing-grief-ended',
    scenarioKey: 'processing-grief',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 64,
    durationMinutes: 12,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi Rohan. Thank you for being here today. How are you doing?',
      },
      {
        from: 'client',
        content:
          'My mother passed away six weeks ago. I... I am still trying to make sense of it.',
      },
      {
        from: 'counselor',
        content:
          'I am so sorry for your loss. Six weeks is still very fresh. What has it been like for you?',
      },
      {
        from: 'client',
        content:
          'Some days I am okay. Other days the smallest thing — her chair, her dupatta — and I just break down.',
      },
      {
        from: 'counselor',
        content:
          'That sounds really hard. Grief has its own rhythm, and those waves can come without warning.',
      },
      {
        from: 'client',
        content:
          'I keep thinking I should have been there at the end. I went home to sleep and she passed in the night.',
      },
      {
        from: 'counselor',
        content:
          'You should not dwell on that — she is in a better place now. Try to focus on the good memories instead.',
      },
      {
        from: 'client',
        content:
          'I... I do not think it is that simple. I just feel like I failed her.',
      },
      {
        from: 'counselor',
        content:
          'I am sorry, that was not the right thing to say. The guilt you are carrying is real and it deserves space. Can you tell me more about what that night has been like in your mind?',
      },
      {
        from: 'client',
        content:
          'I replay it every time I close my eyes. I have barely slept properly since.',
      },
    ],
    events: [
      { eventCode: 'BC-RUDE', occurredAtTurnIndex: 6 },
      { eventCode: 'SC-LOW', occurredAtTurnIndex: 6 },
    ],
  },
  {
    roomKey: 'coping-with-depression-active',
    scenarioKey: 'coping-with-depression',
    status: ScenarioSessionStatus.ACTIVE,
    eventStatus: ScenarioSessionEventStatus.IN_PROGRESS,
    durationMinutes: 0,
    transcript: [],
  },
  {
    roomKey: 'coping-with-depression-ended-2',
    scenarioKey: 'coping-with-depression',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 86,
    durationMinutes: 18,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Anjali, it is good to see you. What is on your mind today?',
      },
      {
        from: 'client',
        content:
          'I am tired. I have been telling myself I am fine but I do not think I am.',
      },
      {
        from: 'counselor',
        content:
          'It takes a lot to say that out loud. Thank you for trusting me with it.',
      },
      {
        from: 'client',
        content:
          'It feels like I am watching my life from a distance. Nothing reaches me.',
      },
      {
        from: 'counselor',
        content:
          'That sounds incredibly isolating — to be present in your life but feel cut off from it.',
      },
      {
        from: 'client',
        content:
          'Yes. Exactly that. I did not know how to put words to it until now.',
      },
      {
        from: 'counselor',
        content:
          'Take your time. You do not need to have it all figured out here.',
      },
      {
        from: 'client',
        content:
          'I keep waiting to feel like myself again and it just... does not come.',
      },
      {
        from: 'counselor',
        content:
          'Waiting like that — and the not-knowing — must be exhausting on top of everything else.',
      },
      {
        from: 'client',
        content:
          'It is. Some mornings I just lie there and the day already feels too heavy.',
      },
      {
        from: 'counselor',
        content:
          'That must be hard for you. What helps, even a little, on the heavy mornings?',
      },
      {
        from: 'client',
        content:
          'Honestly, not much. Sometimes a call with my sister. She does not ask me to be okay.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like she gives you space to just be where you are. That kind of presence matters.',
      },
    ],
    events: [
      { eventCode: 'SS-LISTEN', occurredAtTurnIndex: 4 },
      { eventCode: 'SS-LISTEN', occurredAtTurnIndex: 10 },
    ],
  },
  {
    roomKey: 'processing-grief-ended-2',
    scenarioKey: 'processing-grief',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 71,
    durationMinutes: 16,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi Rohan. How has this past week been for you?',
      },
      {
        from: 'client',
        content:
          'Quieter. Too quiet, maybe. The house feels different without her in it.',
      },
      {
        from: 'counselor',
        content:
          'Silence can hold so much grief. Especially in spaces she filled.',
      },
      {
        from: 'client',
        content:
          'I keep expecting to hear her in the kitchen. And then I remember.',
      },
      {
        from: 'counselor',
        content:
          'Those small expectations — the ones the body holds on to — they are some of the hardest.',
      },
      {
        from: 'client',
        content: 'Yes. It is like my mind knows but my body keeps forgetting.',
      },
      {
        from: 'counselor',
        content:
          'That is such a common part of grief, even though it does not feel common when you are in it.',
      },
      {
        from: 'client',
        content:
          'I have not really cried this week. I am not sure if that is okay.',
      },
      {
        from: 'counselor',
        content:
          'There is no right way to grieve. Tears come when they come, and not coming does not mean you are not feeling.',
      },
      {
        from: 'client',
        content:
          'Thank you. I think I needed to hear that. People keep asking if I am holding up and I do not know what to say.',
      },
      {
        from: 'counselor',
        content:
          'You do not have to have an answer for them. "I am getting through today" is enough, if that is what is true.',
      },
    ],
    events: [{ eventCode: 'SS-LISTEN', occurredAtTurnIndex: 4 }],
  },
  {
    roomKey: 'coping-with-depression-ended-3',
    scenarioKey: 'coping-with-depression',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 52,
    durationMinutes: 10,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi Anjali. So what is going on with you?',
      },
      {
        from: 'client',
        content:
          'I have just been feeling really low for months now. I do not know what to do.',
      },
      {
        from: 'counselor',
        content:
          'Have you tried going for walks or exercising? That usually helps with low mood.',
      },
      {
        from: 'client',
        content:
          'I... I can barely get out of bed most days. Walking feels really far away.',
      },
      {
        from: 'counselor',
        content:
          'Come on, you have to push through it. You will feel better once you start moving.',
      },
      {
        from: 'client',
        content: 'I do not think it is that simple for me right now.',
      },
      {
        from: 'counselor',
        content:
          'Everyone feels down sometimes. Try to think about the things you are grateful for.',
      },
      {
        from: 'client',
        content: 'I... yeah. I will try.',
      },
      {
        from: 'counselor',
        content: 'Great. So what are three things you are grateful for today?',
      },
      {
        from: 'client',
        content: 'I do not really know. Can we talk about something else?',
      },
    ],
    events: [
      { eventCode: 'BC-RUDE', occurredAtTurnIndex: 4 },
      { eventCode: 'SC-LOW', occurredAtTurnIndex: 8 },
    ],
  },
  {
    roomKey: 'financial-stress-anxiety-ended',
    scenarioKey: 'financial-stress-anxiety',
    counselorEmail: 'priya.nair@northwindbh.org',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 88,
    durationMinutes: 16,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Imran, thanks for making time today. What would be useful to talk through?',
      },
      {
        from: 'client',
        content:
          'Business has not been good this year and I have taken on more debt than I would like.',
      },
      {
        from: 'counselor',
        content:
          'That sounds like a heavy thing to be carrying. How has it been affecting you day to day?',
      },
      {
        from: 'client',
        content:
          'I am not sleeping well. And I snap at my staff over small things now.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like the stress is spilling into a lot of areas at once. Have you been able to talk to anyone about it?',
      },
      {
        from: 'client',
        content:
          'Not really. I do not talk about money with anyone, not even my wife.',
      },
      {
        from: 'counselor',
        content:
          'That is a lot to hold alone. What makes it hard to bring it up with her?',
      },
      {
        from: 'client',
        content:
          'I do not want her to worry. But I suppose she probably already knows something is wrong.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like keeping it in is taking its own toll, separate from the debt itself.',
      },
      {
        from: 'client',
        content:
          'Yeah. Maybe I need to just say something to her, even if it is hard.',
      },
    ],
    events: [{ eventCode: 'SS-LISTEN', occurredAtTurnIndex: 4 }],
  },
  {
    roomKey: 'risk-assessment-ended',
    scenarioKey: 'risk-assessment-safety-planning',
    counselorEmail: 'daniel.reyes@northwindbh.org',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 91,
    durationMinutes: 22,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Naomi, thanks for coming in. What has been on your mind lately?',
      },
      {
        from: 'client',
        content: 'I have been feeling really cut off from everyone lately.',
      },
      {
        from: 'counselor',
        content: 'That sounds isolating. How long has it felt this way?',
      },
      {
        from: 'client',
        content:
          'A few months now. Sometimes I think it would just be easier if I was not around.',
      },
      {
        from: 'counselor',
        content:
          'Thank you for telling me that — I want to make sure I understand. When you say easier if you were not around, are you having thoughts of ending your life?',
      },
      {
        from: 'client',
        content:
          'I do not have a plan or anything. It is more like the thought just shows up.',
      },
      {
        from: 'counselor',
        content:
          'I appreciate you being honest with me. Have you ever acted on thoughts like this before, or come close to it?',
      },
      {
        from: 'client',
        content: 'No, never. It just sits there in the back of my mind.',
      },
      {
        from: 'counselor',
        content:
          'That is important to know, and I am glad you told me. Can we put together a plan together for what you can do the next time this thought shows up?',
      },
      { from: 'client', content: 'Okay. I think that would help, actually.' },
    ],
    events: [{ eventCode: 'SS-LISTEN', occurredAtTurnIndex: 4 }],
  },
  {
    roomKey: 'confidentiality-conversation-ended',
    scenarioKey: 'confidentiality-conversation',
    counselorEmail: 'lucia.fernandez@riversidewellness.io',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 95,
    durationMinutes: 9,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Devika, welcome. Before we start, I want to walk you through how confidentiality works here.',
      },
      {
        from: 'client',
        content:
          'My company set this up as a benefit, so I am a little worried about who actually sees what I say.',
      },
      {
        from: 'counselor',
        content:
          'That is a completely fair concern. What you share with me stays between us, with a few specific safety exceptions I will explain.',
      },
      { from: 'client', content: 'Okay, what would those exceptions be?' },
      {
        from: 'counselor',
        content:
          'If I believed you were at risk of serious harm to yourself or someone else, I would need to act on that. Outside of that, none of this goes back to your employer.',
      },
      {
        from: 'client',
        content:
          'That actually helps a lot. Okay, I want to talk about work stress then.',
      },
      {
        from: 'counselor',
        content:
          'Great, I am glad that clears it up. What has work been like recently?',
      },
      {
        from: 'client',
        content:
          'I have been getting panic episodes before client calls. It is getting harder to hide.',
      },
    ],
    events: [{ eventCode: 'SS-LISTEN', occurredAtTurnIndex: 2 }],
  },
  {
    roomKey: 'retirement-identity-loss-active',
    scenarioKey: 'retirement-identity-loss',
    counselorEmail: 'tobias.becker@riversidewellness.io',
    status: ScenarioSessionStatus.ACTIVE,
    eventStatus: ScenarioSessionEventStatus.IN_PROGRESS,
    durationMinutes: 0,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi Suresh, good to see you. How has the week been?',
      },
      {
        from: 'client',
        content:
          'I retired eight months ago and I still do not know what to do with myself.',
      },
    ],
  },
  {
    roomKey: 'family-conflict-mediation-ended',
    scenarioKey: 'family-conflict-mediation',
    counselorEmail: 'simran.kaur@brightpathcounseling.net',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 58,
    durationMinutes: 19,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi Farah, thanks for coming in. What has been going on?',
      },
      {
        from: 'client',
        content:
          'My brothers and I cannot agree on what is best for my father anymore.',
      },
      {
        from: 'counselor',
        content:
          'Family disagreements about care can get complicated. Whose side is actually right here?',
      },
      {
        from: 'client',
        content:
          'I do not know, that is kind of the problem. Every phone call turns into an argument.',
      },
      {
        from: 'counselor',
        content:
          'You should just tell them what the doctor recommended and stop overthinking it.',
      },
      {
        from: 'client',
        content: 'I mean... it is not really that simple for my family.',
      },
      {
        from: 'counselor',
        content:
          'It usually is simpler than people make it. What does the doctor say to do?',
      },
      {
        from: 'client',
        content:
          'I do not think you are really hearing what I am trying to say.',
      },
    ],
    events: [{ eventCode: 'BC-RUDE', occurredAtTurnIndex: 4 }],
  },
  {
    roomKey: 'coping-with-depression-riverside-ended',
    scenarioKey: 'coping-with-depression',
    counselorEmail: 'aisha.bello@riversidewellness.io',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    score: 80,
    durationMinutes: 15,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi Anjali, thank you for coming in today. What would you like to start with?',
      },
      {
        from: 'client',
        content: 'I have not really felt like myself in a long time.',
      },
      {
        from: 'counselor',
        content:
          'That sounds hard to carry. Can you tell me more about what "not myself" feels like?',
      },
      {
        from: 'client',
        content:
          'Just heavy, mostly. Like everything takes more effort than it should.',
      },
      {
        from: 'counselor',
        content:
          'That must be exhausting on top of everything else you are managing.',
      },
      {
        from: 'client',
        content:
          'It is. I used to paint most weekends and I have not touched a brush in months.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like the things that used to bring you joy have started to feel out of reach.',
      },
      { from: 'client', content: 'Yeah. Exactly that.' },
    ],
    events: [{ eventCode: 'SS-LISTEN', occurredAtTurnIndex: 4 }],
  },

  // Session lifecycle variety — status/eventStatus ABANDONED and endReason
  // were previously entirely unexercised (see ScenarioSessionStatus's doc
  // comment for why this is a real, deliberately-added third lifecycle state).
  {
    roomKey: 'coping-with-depression-abandoned',
    scenarioKey: 'coping-with-depression',
    counselorEmail: 'fatima.siddiqui@northwindbh.org',
    status: ScenarioSessionStatus.ABANDONED,
    eventStatus: ScenarioSessionEventStatus.ABANDONED,
    abandonedReason: ScenarioSessionAbandonReason.STUCK_ACTIVE_SWEEP,
    durationMinutes: 3,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi, thanks for coming in. Where would you like to start?',
      },
      {
        from: 'client',
        content: 'I am not sure, actually. Give me a second.',
      },
    ],
  },
  {
    roomKey: 'processing-grief-room-finished',
    scenarioKey: 'processing-grief',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.ABANDONED,
    abandonedReason: ScenarioSessionAbandonReason.ROOM_FINISHED_WITHOUT_END,
    durationMinutes: 6,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi, thank you for being here. How are you doing today?',
      },
      {
        from: 'client',
        content: 'Okay, I think. Still getting used to everything.',
      },
      {
        from: 'counselor',
        content: 'That makes sense. Take whatever time you need.',
      },
      {
        from: 'client',
        content:
          'Can we talk about the funeral arrangements? That has been hard.',
      },
    ],
  },
  {
    roomKey: 'risk-assessment-interrupted',
    scenarioKey: 'risk-assessment-safety-planning',
    counselorEmail: 'priya.nair@northwindbh.org',
    status: ScenarioSessionStatus.ENDED,
    eventStatus: ScenarioSessionEventStatus.COMPLETED,
    endReason: ScenarioSessionEndReason.TECHNICAL_INTERRUPTION,
    score: 63,
    durationMinutes: 11,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi, thanks for coming in. What has been going on for you?',
      },
      {
        from: 'client',
        content: 'I have been having a hard time lately, more than usual.',
      },
      {
        from: 'counselor',
        content: 'I am glad you are telling me. Can you say more about that?',
      },
      {
        from: 'client',
        content: 'I do not really know how to put it into words yet.',
      },
    ],
  },
];

export const simulationCreditsDefault: SimulationCreditsFixture = {
  creditLimit: 60,
  consumedCredits: 0,
};

// Real gate (scenario-session.service.ts): a session start is blocked when
// consumedCredits + 20 > creditLimit — 20 credits are reserved per start
// (1200s default session TTL / 60s-per-credit). So a user can be genuinely
// "blocked" while still under their limit (e.g. 58/60), and the boundary
// case (40+20 = 60, not > 60) still has exactly one session left.
export const simulationCreditsByEmail: Record<
  string,
  SimulationCreditsFixture
> = {
  'learner@example.com': { creditLimit: 120, consumedCredits: 23 },
  'lucia.fernandez@riversidewellness.io': {
    creditLimit: 240,
    consumedCredits: 96,
  },
  'fatima.siddiqui@northwindbh.org': {
    creditLimit: 60,
    consumedCredits: 40,
  },
  'priya.nair@northwindbh.org': {
    creditLimit: 60,
    consumedCredits: 58,
  },
  'daniel.reyes@northwindbh.org': {
    creditLimit: 90,
    consumedCredits: 90,
  },
  'omar.hassan@riversidewellness.io': {
    creditLimit: 30,
    consumedCredits: 12,
  },
  // Over-consumed (SimulationCreditsService.update itself rejects
  // limit < consumed, so this state is seed-only) — exercises negative-
  // remaining rendering.
  'simran.kaur@brightpathcounseling.net': {
    creditLimit: 60,
    consumedCredits: 61,
  },
};

// Shared-for-review entries on the two completed sessions. Each review has a
// note from the learner, a "general" thread, a couple of pinned per-message
// threads with replies, plus reactions and read-status so the review listing
// renders with realistic counts.
export const reviews: ReviewFixture[] = [
  {
    sessionRoomId: 'seed-room-coping-with-depression-ended',
    authorEmail: 'learner@example.com',
    note: 'Sharing this for peer feedback. I tried to slow down and stay with her pain rather than jump to solutions — would love thoughts on whether my reflections landed.',
    reactions: [
      { email: 'admin@example.com', reaction: '👏' },
      { email: 'org-admin@example.com', reaction: '❤️' },
    ],
    readByEmails: ['admin@example.com', 'org-admin@example.com'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'Overall a really warm, unhurried session. The pacing felt right for someone presenting with low mood.',
            reactions: [{ email: 'learner@example.com', reaction: '🙏' }],
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  'Thank you — pacing was the thing I was most nervous about.',
              },
            ],
          },
          {
            authorEmail: 'admin@example.com',
            content:
              'One thought: consider gently checking on safety/risk when a client mentions "not recognising herself anymore". Worth holding in mind for next time.',
          },
        ],
      },
      {
        turnIndex: 6,
        selection: { startIndex: 0, endIndex: 26 },
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'Lovely reflection here — naming how long she has carried this validated the experience without minimising it.',
            reactions: [{ email: 'admin@example.com', reaction: '👍' }],
          },
        ],
      },
      {
        turnIndex: 10,
        selection: { startIndex: 36, endIndex: 95 },
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'Nice paraphrase. You could have paused for a beat after this — let the weight of "painful place to be" land before asking the next question.',
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  'Good call. I felt myself rushing to fill the silence.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-processing-grief-ended',
    authorEmail: 'learner@example.com',
    note: 'I know I slipped with the "better place" comment — appreciate any feedback on how to repair that kind of misstep in the moment.',
    reactions: [{ email: 'org-admin@example.com', reaction: '🙏' }],
    readByEmails: ['org-admin@example.com'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'The repair was actually well done — you named it as not the right thing to say and turned back to his experience. That is the harder skill.',
            reactions: [
              { email: 'learner@example.com', reaction: '❤️' },
              { email: 'org-admin@example.com', reaction: '👏' },
            ],
          },
        ],
      },
      {
        turnIndex: 6,
        selection: { startIndex: 21, endIndex: 47 },
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'This is the kind of platitude grieving clients hear constantly — it tends to close the conversation rather than open it.',
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  'Agreed. I noticed his energy drop the moment I said it.',
              },
              {
                authorEmail: 'admin@example.com',
                content:
                  'Good awareness. Next time try sitting with the silence instead of reaching for something to say.',
              },
            ],
          },
        ],
      },
      {
        turnIndex: 8,
        selection: { startIndex: 0, endIndex: 47 },
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'Strong recovery — owning the misstep and inviting him back in. The phrase "deserves space" was particularly grounding.',
            reactions: [{ email: 'learner@example.com', reaction: '🙏' }],
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-coping-with-depression-ended-2',
    authorEmail: 'learner@example.com',
    note: 'A second pass with Anjali — I tried to stay with the "watching life from a distance" framing instead of jumping to coping skills. Curious if it felt steady throughout.',
    reactions: [
      { email: 'admin@example.com', reaction: '❤️' },
      { email: 'org-admin@example.com', reaction: '👏' },
    ],
    readByEmails: ['admin@example.com'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'Really attuned session. The reflection about her sister "not asking her to be okay" was a lovely thread to pick up on.',
            reactions: [{ email: 'learner@example.com', reaction: '🙏' }],
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  'Thanks — I almost moved past it but something in her tone made me circle back.',
              },
            ],
          },
        ],
      },
      {
        turnIndex: 4,
        selection: { startIndex: 0, endIndex: 30 },
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              '"Incredibly isolating" landed well — naming the feeling without trying to fix it.',
            reactions: [{ email: 'admin@example.com', reaction: '👍' }],
          },
        ],
      },
      {
        turnIndex: 10,
        selection: { startIndex: 0, endIndex: 27 },
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'Nice — you validated the weight before pivoting to the gentle question about what helps. That order matters.',
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-processing-grief-ended-2',
    authorEmail: 'learner@example.com',
    note: 'Second session with Rohan. I wanted to normalise the absence of tears without sounding dismissive — would love a read on whether that landed.',
    reactions: [{ email: 'org-admin@example.com', reaction: '❤️' }],
    readByEmails: ['org-admin@example.com', 'admin@example.com'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'The pacing was warm and unhurried. You held space for the silence in his house without rushing him out of it.',
            reactions: [{ email: 'learner@example.com', reaction: '🙏' }],
          },
        ],
      },
      {
        turnIndex: 8,
        selection: { startIndex: 0, endIndex: 32 },
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              '"There is no right way to grieve" — exactly the kind of reassurance that opens doors rather than closing them.',
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  "Thank you. I held that line in my head from last week's feedback.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-coping-with-depression-ended-3',
    authorEmail: 'learner@example.com',
    note: 'I know this one did not go well — sharing it because I want to understand where I lost her. Honest feedback welcome.',
    readByEmails: ['admin@example.com', 'org-admin@example.com'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              'Appreciate you sharing a session that felt off — that is how the harder skills get built. A few specific spots below.',
            reactions: [
              { email: 'learner@example.com', reaction: '🙏' },
              { email: 'org-admin@example.com', reaction: '❤️' },
            ],
          },
        ],
      },
      {
        turnIndex: 2,
        selection: { startIndex: 0, endIndex: 70 },
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'Jumping to "have you tried walks?" so early skips the validation step. The client has not felt heard yet.',
            replies: [
              {
                authorEmail: 'learner@example.com',
                content:
                  'Yeah, looking back I went into problem-solving mode straight away.',
              },
              {
                authorEmail: 'admin@example.com',
                content:
                  'A useful reframe: in the first few turns, your job is to understand, not to help.',
              },
            ],
          },
        ],
      },
      {
        turnIndex: 4,
        selection: { startIndex: 0, endIndex: 35 },
        authorEmail: 'admin@example.com',
        comments: [
          {
            authorEmail: 'admin@example.com',
            content:
              '"Push through it" is the kind of phrase that tells a depressed client her experience is a personal failure. Worth catching in the moment.',
          },
        ],
      },
      {
        turnIndex: 6,
        selection: { startIndex: 0, endIndex: 30 },
        authorEmail: 'org-admin@example.com',
        comments: [
          {
            authorEmail: 'org-admin@example.com',
            content:
              'Gratitude prompts can be valuable later — but offered here, they read as another instruction she is failing at.',
          },
        ],
      },
    ],
  },

  // Non-'ally' reviews — confirm the tenantId-derived-from-session fix above
  // actually surfaces reviews outside the default tenant, and give
  // SIMULATION_REVIEWER accounts something to review in their own tenant.
  {
    sessionRoomId: 'seed-room-risk-assessment-ended',
    authorEmail: 'daniel.reyes@northwindbh.org',
    reactions: [{ email: 'priya.nair@northwindbh.org', reaction: '👍' }],
    readByEmails: ['wei.zhang@northwindbh.org'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'wei.zhang@northwindbh.org',
        comments: [
          {
            authorEmail: 'wei.zhang@northwindbh.org',
            content:
              'Strong safety-assessment session overall — the direct question about intent was asked clearly and without hesitation.',
            replies: [
              {
                authorEmail: 'james.okafor@northwindbh.org',
                content:
                  'Agreed. Also good that a concrete follow-up plan was offered rather than ending on the disclosure itself.',
              },
            ],
          },
        ],
      },
      {
        turnIndex: 4,
        selection: { startIndex: 0, endIndex: 40 },
        authorEmail: 'wei.zhang@northwindbh.org',
        comments: [
          {
            authorEmail: 'wei.zhang@northwindbh.org',
            content:
              'Good instinct naming what she said back to her before asking about intent — that softened a hard question.',
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-financial-stress-anxiety-ended',
    authorEmail: 'priya.nair@northwindbh.org',
    status: ReviewStatus.HIDDEN,
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'wei.zhang@northwindbh.org',
        comments: [
          {
            authorEmail: 'wei.zhang@northwindbh.org',
            content:
              'Flagged for a tone check — holding for a follow-up conversation before this goes back to the counselor.',
            hidden: true,
          },
        ],
      },
    ],
  },
  {
    sessionRoomId: 'seed-room-coping-with-depression-riverside-ended',
    authorEmail: 'aisha.bello@riversidewellness.io',
    reactions: [
      { email: 'lucia.fernandez@riversidewellness.io', reaction: '❤️' },
      { email: 'omar.hassan@riversidewellness.io', reaction: '👏' },
    ],
    readByEmails: ['omar.hassan@riversidewellness.io'],
    threads: [
      {
        turnIndex: 'general',
        authorEmail: 'lucia.fernandez@riversidewellness.io',
        comments: [
          {
            authorEmail: 'lucia.fernandez@riversidewellness.io',
            content:
              'Nice unhurried pacing throughout — you let her sit with "not myself" instead of rushing to define it for her.',
            reactions: [
              { email: 'aisha.bello@riversidewellness.io', reaction: '🙏' },
            ],
          },
          {
            authorEmail: 'omar.hassan@riversidewellness.io',
            content:
              'Agreed. Consider a brief check on sleep/appetite next time — useful baseline data for a first depression-focused session.',
          },
        ],
      },
    ],
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
  // A streak is a sequenced mini-goal mechanic: it needs rungs the whole way up
  // so the "next milestone" the UI shows never runs out. Keep this ladder in
  // step with migration 1887000000000-SeedActiveDayStreakBadgeLadder.
  {
    name: 'Consistent Start',
    description: 'Build a 3-day active streak.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 3,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Week One',
    description: 'Practise every day for a week.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 7,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Fortnight Focus',
    description: 'Keep a 14-day active streak going.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 14,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Monthly Momentum',
    description: 'Reach a 30-day active streak.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 30,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Two Month Steady',
    description: 'Reach a 60-day active streak.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 60,
    groupNames: [UserRole.LEARNER],
  },
  {
    name: 'Century Streak',
    description: 'Practise on 100 consecutive days.',
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    count: 100,
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
  {
    // Being authored — not yet awardable, and not awarded to anyone. Exercises
    // the DRAFT badge-lifecycle state (BadgeStatus has no ARCHIVED value).
    name: 'Feedback Champion',
    description: 'Give 25 comments or reactions.',
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    count: 25,
    groupNames: [UserRole.LEARNER],
    status: BadgeStatus.DRAFT,
  },
];

// Which learners have actually earned which badges — until now `badges` only
// defined what CAN be earned; nobody ever had. Each pick is backed by that
// learner's already-seeded activity (session count, track/pathway completion,
// review comments/reactions). Dates spread out and a few left UNVIEWED so a
// "new badge" indicator has something to render. Never awards an XP_LEVEL
// badge — UserProgress/XpEvent aren't seeded, so those can't be plausibly
// earned yet.
export const earnedBadges: EarnedBadgeFixture[] = [
  {
    email: 'learner@example.com',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 21,
  },
  {
    email: 'learner@example.com',
    badgeName: 'Consistent Start',
    earnedDaysAgo: 18,
  },
  {
    email: 'learner@example.com',
    badgeName: 'Community Contributor',
    earnedDaysAgo: 12,
  },
  {
    email: 'learner@example.com',
    badgeName: 'Crowd Favorite',
    earnedDaysAgo: 9,
    viewed: false,
  },
  {
    email: 'priya.nair@northwindbh.org',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 6,
  },
  {
    email: 'priya.nair@northwindbh.org',
    badgeName: 'Consistent Start',
    earnedDaysAgo: 4,
    viewed: false,
  },
  {
    email: 'daniel.reyes@northwindbh.org',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 7,
  },
  {
    email: 'lucia.fernandez@riversidewellness.io',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 14,
  },
  {
    email: 'aisha.bello@riversidewellness.io',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 3,
    viewed: false,
  },
  {
    // Earned before her tenant's suspension — badges survive tenant status.
    email: 'simran.kaur@brightpathcounseling.net',
    badgeName: 'Simulation Starter',
    earnedDaysAgo: 30,
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
