import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import { RehearsalTraineeProfile } from '../enum/rehearsal-status.enum';

export const REHEARSAL_END_STATUSES: RehearsalStatus[] = [
  RehearsalStatus.COMPLETED,
  RehearsalStatus.CANCELLED,
  RehearsalStatus.FAILED,
];

export const REHEARSAL_PENDING_STATUSES: RehearsalStatus[] = [
  RehearsalStatus.STARTED,
  RehearsalStatus.IN_PROGRESS,
];

// Redis TTL timer (scenario-report pattern): key set on run creation, deleted
// on any end status; keyspace-expiry notification fails runs that outlive the
// configured timeout (config.roleplayStudio.rehearsalTimeoutMinutes).
export const REHEARSAL_REDIS_KEY_PREFIX = 'roleplay-rehearsal';
export const REHEARSAL_EXPIRED_CHANNEL = '__keyevent@0__:expired';

// FROZEN dispatch contract: rooms for v2 sessions are `roleplay-<uuid>`.
export const ROLEPLAY_ROOM_ID_PREFIX = 'roleplay-';

// FROZEN dispatch contract: inline the compiled spec in LiveKit room metadata
// when its serialized size is under this budget; otherwise send a specFetch
// pointer at the api-key-guarded spec-version webhook.
export const ROLEPLAY_SPEC_INLINE_MAX_BYTES = 55 * 1024;

// FROZEN rehearsal contract: the three simulated trainee profiles every run
// exercises.
export const REHEARSAL_TRAINEE_PROFILES: RehearsalTraineeProfile[] = [
  RehearsalTraineeProfile.SKILLED,
  RehearsalTraineeProfile.POOR,
  RehearsalTraineeProfile.ADVERSARIAL,
];

export const REHEARSAL_DEFAULT_TURNS_PER_PROFILE = 8;

// Cap on the total number of simulated sessions (trainee profiles + agent
// test cases) a single rehearsal may run.
export const REHEARSAL_MAX_UNITS = 12;

// Transcript label for agent-test-case sessions. A *label* stored in
// rehearsal_transcripts.traineeProfile, NOT a RehearsalTraineeProfile enum
// member — profile selection stays SKILLED/POOR/ADVERSARIAL only.
export const REHEARSAL_CONDITION_DRIVEN_LABEL = 'CONDITION_DRIVEN';

// Auto-improve loop: redis watchdog prefix (shares the rehearsal timer's
// keyspace-expiry subscription; the handler branches on prefix).
export const IMPROVEMENT_REDIS_KEY_PREFIX = 'roleplay-improvement';
export const IMPROVEMENT_DEFAULT_MAX_ROUNDS = 3;
export const IMPROVEMENT_MAX_ROUNDS_LIMIT = 6;
// Default stop targets — deterministic gate (all test cases pass) first;
// judged overall as the secondary bar.
export const IMPROVEMENT_DEFAULT_TARGETS = {
  minOverall: 70,
  requireAllTestCasesPass: true,
} as const;
// Verification tolerance for a proposal's predicted dimension movement.
export const IMPROVEMENT_VERIFICATION_TOLERANCE = 3;

// Spec structural bounds (FROZEN contract).
export const SPEC_MIN_STATES = 3;
export const SPEC_MAX_STATES = 6;

// Prompt registry codes (src/prompts/roleplay_copilot/*.txt).
export const ROLEPLAY_COPILOT_PROMPT_DIR = 'roleplay_copilot';
export const ROLEPLAY_COPILOT_PROMPTS = {
  INTERVIEWER_SYSTEM: 'roleplay_copilot_interviewer_system',
  INFERENCE_PASS: 'roleplay_copilot_inference_pass',
  SPEC_COMPILER: 'roleplay_copilot_spec_compiler',
  REHEARSAL_CRITIQUE: 'roleplay_copilot_rehearsal_critique',
} as const;

export const COPILOT_MAX_TOKENS = 8192;
