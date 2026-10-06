/**
 * ally-ai text-helpline copilot endpoints (docs/text-helpline.md §9.1).
 * Field names are ally-ai's (snake_case) because these are its wire shapes.
 */

export interface HelplineCopilotTurnMessage {
  role: 'talker' | 'listener';
  content: string;
}

/** Prompt overrides keyed by full prompt code (`ally_ai_helpline_…`). */
export type HelplinePromptOverrides = Record<
  string,
  {
    prompt?: string;
    provider?: string;
    model?: string;
    temperature?: number;
    availableVariables?: unknown;
  }
>;

export interface HelplineRiskRequest {
  message: string;
  /** The turns before `message`, oldest first, at most 4. */
  recent: HelplineCopilotTurnMessage[];
  language: string;
  prompts?: HelplinePromptOverrides | null;
}

export interface HelplineRiskResponse {
  is_crisis: boolean;
  confidence: number;
  /** Verbatim substring of `message`, ≤ 120 chars. Never logged by ally-be. */
  signal: string;
  subject: 'SELF' | 'OTHER' | 'UNCLEAR';
  failed: boolean;
  provider?: string;
  model?: string;
}

export interface HelplineTurnRequest {
  /** The last ≤ 12 TEXT turns, oldest first. */
  messages: HelplineCopilotTurnMessage[];
  rolling_summary: string;
  language: string;
  include_nudge: boolean;
  risk_level: 'NONE' | 'ELEVATED' | 'HIGH';
  risk_subject: 'SELF' | 'OTHER' | 'UNCLEAR' | '';
  prompts?: HelplinePromptOverrides | null;
}

export interface HelplineTurnResponse {
  stage: 'Engage' | 'Understand' | 'Support' | 'Close' | '';
  nudge: string;
  suggestions: { text: string; skill_key: string }[];
  failed: boolean;
  provider?: string;
  model?: string;
}
