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
 *
 * `engine` picks which CLI `bug-hunt-sweep.yml`/`bug-fix-session.yml` invoke, same concept as
 * Builder's `defaultEngine`. Gemini CLI has no equivalent to the Task-tool subagent dispatch
 * `escalationModel` relies on (confirmed: no subagent-dispatch primitive comparable to
 * `.claude/agents/bug-escalation.md`, only its own separate `delegate_to_agent` tool that this
 * hasn't been built against) — so a `gemini`-engine run skips escalation entirely rather than
 * pretending to honor `escalationModel`. `escalationModel` stays a Claude-Code-only field.
 */
/**
 * The values `engine` takes. Kept as plain `string` on the interface below,
 * same as Builder's own `defaultEngine` — no runtime enum validation on either.
 *
 * `opencode` (added 2026-09-30) is a multi-provider harness rather than a
 * vendor: it runs Anthropic, Google and OpenAI models alike, named as
 * provider/model, and — unlike Gemini CLI — has Task-tool subagents, so the
 * Verify phase's two verifiers and `escalationModel` both work on it whatever
 * model is underneath. The workflows derive the provider from the model id's
 * shape (`gemini-*` → google, `claude-*` → anthropic, `gpt-*` → openai), so
 * settings keep storing bare ids. Builder already runs on it in CI.
 */
export type BugHunterEngine = 'claude-code' | 'gemini' | 'opencode';

export interface BugHunterModelSettings {
  /** Which CLI the sweep/fix session runs on: a `BugHunterEngine` value. */
  engine: string;
  /** Model the main sweep/fix-session invocation runs on. */
  defaultModel: string;
  /**
   * The stronger model one hard fix may escalate to. Handed to OpenCode's
   * escalation agent by value at run time; since 2026-10-09 no workflow
   * rewrites the committed `.claude/agents/bug-escalation.md` any more (fix
   * PRs were committing the rewrite). Ignored for `gemini`, which has no
   * subagents.
   */
  escalationModel: string;
}

export const BUG_HUNTER_MODEL_SETTINGS_NAME = 'bug_hunter.models';

/** Defaults, applied per-field over whatever the row holds — see the service's `merge`. */
/**
 * Gemini, not Claude: there is no Claude budget, and the sweep/fix workflows now refuse any engine
 * but `gemini` rather than run Claude Code. `escalationModel` is inert on that engine, but the
 * workflows require it non-null, so it names the same Gemini model.
 */
export const DEFAULT_BUG_HUNTER_MODEL_SETTINGS: BugHunterModelSettings = {
  engine: 'gemini',
  defaultModel: 'gemini-2.5-pro',
  escalationModel: 'gemini-2.5-pro',
};
