import { AgentTestCaseType } from 'src/learn/enum/agent-test-case.enum';

/**
 * Agent-test-case snapshot stored camelCase-keyed in
 * `roleplay_test_runs.config.testCases` and per report in
 * `roleplay_test_reports.testCaseSnapshot`: content is copied at launch
 * because agent_test_cases is global + hard-deleted and ai-learn has no DB
 * access — historical runs must stay self-describing, and auto-improve
 * re-runs replay the parent report's stored snapshot (never a DB re-read).
 */
export interface RoleplayTestCaseSnapshot {
  id: string;
  title: string;
  type: AgentTestCaseType;
  tags: string[];
  description?: string | null;
  // Condition test cases only.
  condition?: string | null;
  test?: string | null;
  // Full-session test cases only.
  rubrics?: { criteria: string; scoringInstructions: string }[] | null;
}

/** Snake_case wire shape of one test case (ally-be → ally-ai-learn). */
export interface RoleplayTestRunWireTestCase {
  id: string;
  title: string;
  category?: string | null;
  type: AgentTestCaseType;
  condition?: string | null;
  test?: string | null;
  rubrics?: { criteria: string; scoring_instructions: string }[];
}

/**
 * FROZEN ally-be → ally-ai-learn contract:
 * POST api/v1/roleplay-rehearsal/run (202 accepted) — ai-learn keeps its
 * internal "rehearsal" naming (routes + payload keys); `rehearsal_id` carries
 * our runId. `trainee_profiles` is always `[]` (test-case-only runs); the
 * engine's per-run semaphores/cancel registry are process-local, which is
 * fine for the single-container ai-learn deployment.
 */
export interface RoleplayTestRunRequest {
  rehearsal_id: string;
  /** Compiled runtime spec (ui/authoring fields stripped). */
  spec: Record<string, any>;
  spec_schema_version: string;
  config: {
    trainee_profiles: string[];
    turns_per_profile: number;
    language_id?: number;
    judge_model?: string | null;
    trainee_model?: string | null;
    test_cases: RoleplayTestRunWireTestCase[];
  };
}
