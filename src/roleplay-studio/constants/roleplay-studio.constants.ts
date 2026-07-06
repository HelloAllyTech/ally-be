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
