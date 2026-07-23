import {
  RoleplayTestReportStatus,
  RoleplayTestRunStatus,
} from '../enum/roleplay-test-run.enum';

// FROZEN dispatch contract: rooms for v2 sessions are `roleplay-<uuid>`.
export const ROLEPLAY_ROOM_ID_PREFIX = 'roleplay-';

// ------------------------------------------------------------- Improve runs

export const TEST_RUN_END_STATUSES: RoleplayTestRunStatus[] = [
  RoleplayTestRunStatus.COMPLETED,
  RoleplayTestRunStatus.CANCELLED,
  RoleplayTestRunStatus.FAILED,
];

export const TEST_RUN_PENDING_STATUSES: RoleplayTestRunStatus[] = [
  RoleplayTestRunStatus.STARTED,
  RoleplayTestRunStatus.IN_PROGRESS,
];

export const TEST_REPORT_END_STATUSES: RoleplayTestReportStatus[] = [
  RoleplayTestReportStatus.COMPLETED,
  RoleplayTestReportStatus.CANCELLED,
  RoleplayTestReportStatus.FAILED,
];

// Redis TTL timer (scenario-report pattern): key set on run creation, deleted
// on any end status; keyspace-expiry notification fails runs that outlive the
// configured timeout (config.roleplayStudio.testRunTimeoutMinutes, scaled by
// unit count at run creation).
export const TEST_RUN_REDIS_KEY_PREFIX = 'roleplay-test-run';
// Auto-improve turn watchdog (shares the test-run timer's keyspace-expiry
// subscription; the handler branches on prefix): a report stuck IMPROVING
// past config.roleplayStudio.improveTurnTimeoutMinutes is failed.
export const IMPROVE_REDIS_KEY_PREFIX = 'roleplay-improve';
export const TEST_RUN_EXPIRED_CHANNEL = '__keyevent@0__:expired';

export const TEST_RUN_DEFAULT_TURNS_PER_CASE = 8;

// Cap on the number of agent test cases a single test run may exercise.
export const TEST_RUN_MAX_CASES = 12;

// Per-session copilot turn mutex (SET NX EX) — serializes concurrent
// /messages/stream calls so parallel turns can't clobber the draft.
export const COPILOT_TURN_LOCK_PREFIX = 'copilot-turn';

// SSE keep-alive: large update_spec generations can emit nothing for 30-60s+,
// which trips proxy idle timeouts without a heartbeat.
export const COPILOT_SSE_PING_INTERVAL_MS = 15_000;

/**
 * Server-side auto-improve injection appended to the trainer's short chat
 * line ({{token}} placeholders are filled from the test report row before the
 * turn starts — never by the client).
 */
export const AUTO_IMPROVE_MESSAGE_TEMPLATE = `[auto-improve request for test report {{reportId}}]
The trainer ran agent test case "{{title}}" ({{type}}) against spec version v{{versionNumber}}; the judge produced:
<test_report>{{reportMarkdown}}</test_report>
<test_case>{{testCaseSnapshot}}</test_case>
Task: follow your AUTO-IMPROVE REQUESTS protocol — diagnose why the runtime produced this outcome, apply targeted
update_spec patches fixing the root cause, then summarise. The same test case re-runs automatically when you finish.
If the report shows the spec already behaves correctly, say so and make NO update_spec call.`;

// FROZEN dispatch contract: inline the compiled spec in LiveKit room metadata
// when its serialized size is under this budget; otherwise send a specFetch
// pointer at the api-key-guarded spec-version webhook.
export const ROLEPLAY_SPEC_INLINE_MAX_BYTES = 55 * 1024;

// Spec structural bounds (FROZEN contract).
export const SPEC_MIN_STATES = 3;
export const SPEC_MAX_STATES = 6;

// Prompt registry codes (src/prompts/roleplay_copilot/*.txt).
export const ROLEPLAY_COPILOT_PROMPT_DIR = 'roleplay_copilot';
export const ROLEPLAY_COPILOT_PROMPTS = {
  INTERVIEWER_SYSTEM: 'roleplay_copilot_interviewer_system',
  INFERENCE_PASS: 'roleplay_copilot_inference_pass',
  SPEC_COMPILER: 'roleplay_copilot_spec_compiler',
} as const;

export const COPILOT_MAX_TOKENS = 8192;
