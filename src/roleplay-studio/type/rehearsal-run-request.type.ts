/**
 * Agent-test-case snapshot shipped to ai-learn (and stored camelCase-keyed as
 * `rehearsal_runs.config.testCases`): content is copied at launch because
 * agent_test_cases is global + hard-deleted and ai-learn has no DB access —
 * historical runs must stay self-describing.
 */
export interface RoleplayRehearsalTestCase {
  id: string;
  title: string;
  category?: string | null;
  condition: string;
  test: string;
}

/**
 * FROZEN ally-be → ally-ai-learn contract:
 * POST api/v1/roleplay-rehearsal/run (202 accepted).
 * `config.test_cases` (snake_case key) carries the agent-test-case snapshots
 * — one condition-driven session each; `[]` when none were selected.
 */
export interface RoleplayRehearsalRunRequest {
  rehearsal_id: string;
  /** Compiled runtime spec (ui/agentTestCaseIds stripped). */
  spec: Record<string, any>;
  spec_schema_version: string;
  config: {
    trainee_profiles: string[];
    turns_per_profile: number;
    language_id: number;
    judge_model?: string | null;
    test_cases: RoleplayRehearsalTestCase[];
  };
}
