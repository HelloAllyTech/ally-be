/**
 * FROZEN ally-be → ally-ai-learn contract:
 * POST api/v1/roleplay-rehearsal/run (202 accepted).
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
  };
}
