/**
 * The `bug_hunter.models` global-settings blob.
 *
 * A `GlobalSettings` row rather than a column on `bug_hunter_settings` — that entity is a
 * singleton kill-switch row and adding typed model columns to it would repeat the mistake
 * Builder's own `builder_settings` already made (a bespoke settings table hand-copied from this
 * one). `GlobalSettings` is the platform's actual reusable settings mechanism (already backing
 * AppVersion and the WhatsApp bot), so Bug Hunter's model choices live there instead.
 *
 * Two tiers, matching what the pipeline already does: `defaultModel` runs the sweep/fix session
 * end to end, and `escalationModel` is handed to the `bug-escalation` subagent for the specific
 * findings that warrant it (see BUG_HUNT_ESCALATION_GUIDANCE). Not per-repo — Builder's own model
 * settings aren't per-repo either, and nothing here needs to be yet.
 */
export interface BugHunterModelSettings {
  /** Model the main sweep/fix-session `claude -p` invocation runs on. */
  defaultModel: string;
  /** Model pinned into `.claude/agents/bug-escalation.md` before each run. */
  escalationModel: string;
}

export const BUG_HUNTER_MODEL_SETTINGS_NAME = 'bug_hunter.models';

/** Defaults, applied per-field over whatever the row holds — see the service's `merge`. */
export const DEFAULT_BUG_HUNTER_MODEL_SETTINGS: BugHunterModelSettings = {
  defaultModel: 'claude-sonnet-5',
  escalationModel: 'claude-opus-5',
};
