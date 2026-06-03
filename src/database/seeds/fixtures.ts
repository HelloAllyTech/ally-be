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
import { BehaviorInstructionCategory } from '../../learn/enum/behavior-instruction.enum';
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

export interface ScenarioBehaviorInstructionFixture {
  category: BehaviorInstructionCategory;
  behaviorNames: string[];
  stateInstructions: Array<{ stateId: string; instruction: string }>;
}

export interface ScenarioFixture {
  key: string;
  title: string;
  description: string;
  competencyName: string;
  coverImageUrl: string;
  metadata: Record<string, any>;
  behaviorInstructions: ScenarioBehaviorInstructionFixture[];
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
  // Stable identifier appended to `seed-room-` to form roomId. Required so
  // multiple sessions can share a scenario+status without colliding, and so
  // review fixtures can pin to a specific session by room id.
  roomKey: string;
  scenarioKey: string;
  status: ScenarioSessionStatus;
  eventStatus: ScenarioSessionEventStatus;
  score?: number;
  durationMinutes: number;
  transcript: Array<{ from: 'counselor' | 'client'; content: string }>;
  events?: Array<{
    eventCode: string;
    occurredAtTurnIndex: number;
  }>;
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
  {
    email: 'reviewer@example.com',
    name: 'Simulation Reviewer',
    roles: [UserRole.SIMULATION_REVIEWER],
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
          'Minimises feelings',
          'Offers premature reassurance',
          'Pushes for positivity',
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
    behaviorInstructions: [
      {
        category: BehaviorInstructionCategory.SHOULD_DO,
        behaviorNames: [
          'Normalises the grief response',
          'Sits with silence and emotion',
          'Reflects feelings back accurately',
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
          'Rushes the grieving process',
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
];

export const pathways: PathwayFixture[] = [
  {
    title: 'Mental Health Counseling Fundamentals',
    description:
      'Introductory path covering core mental health presentations: low mood and grief.',
    scenarioKeys: ['coping-with-depression', 'processing-grief'],
  },
];

export const cases: CaseFixture[] = [
  {
    title: 'Mood and Grief Presentations',
    description:
      'Sample case covering common mental health presentations a new counselor will encounter.',
    scenarioKeys: ['coping-with-depression', 'processing-grief'],
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
];

export const simulationCreditsDefault: SimulationCreditsFixture = {
  creditLimit: 60,
  consumedCredits: 0,
};

export const simulationCreditsByEmail: Record<
  string,
  SimulationCreditsFixture
> = {
  'learner@example.com': { creditLimit: 120, consumedCredits: 23 },
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
